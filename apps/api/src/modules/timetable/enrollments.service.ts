import { Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import { AppError } from "../../common/errors/app-error";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type {
  AccentColor, CourseSectionDto, CreateEnrollmentInput, EnrollmentDto, EnrollmentState,
  UpdateEnrollmentInput,
} from "./enrollments.types";

/**
 * Add, drop, recolour and reorder the caller's own timetable.
 *
 * ## Drop is a state change, not a delete
 *
 * `DELETE /v1/enrollments/:id` sets `state = 'dropped'` and returns 204. It
 * does not remove the row, for two reasons that are not stylistic:
 *
 * 1. **Attendance history has to survive it.** `public.absence` rows hang off
 *    the enrollment, and `enrollment.absence_count` / `absence_units` are the
 *    counters behind the `4 / 12` ring. Deleting the enrollment cascades those
 *    away, so a student who drops and re-adds a section returns with a clean
 *    absence record — which, on a course where twelve absences bar you from the
 *    exam, is a way to launder your way back under the limit.
 * 2. **`enrollment_uniq (app_user_id, section_id)` makes re-adding an upsert.**
 *    With a soft drop the same row comes back to `enrolled`; with a hard delete
 *    the second add is a brand-new row and the history is gone anyway.
 *
 * The week grid and the enrollment list therefore filter on
 * `state = 'enrolled'` rather than on the row existing.
 *
 * ## Everything here is own-row
 *
 * The pool is BYPASSRLS, so `app_user_id = ${user.appUserId}` in every
 * predicate is the whole of what stops one student reading or editing
 * another's timetable. A timetable is a movement profile — where a named
 * person is, in which room, at which hour, all term. There is deliberately no
 * parameter anywhere in this service that names a user.
 */
@Injectable()
export class EnrollmentsService {
  constructor(private readonly db: SqlProvider) {}

  /**
   * The caller's enrollments for a term, defaulting to the current one.
   *
   * `state` defaults to `enrolled` rather than to everything: the timetable is
   * the overwhelmingly common caller and a dropped course reappearing in the
   * week grid is the bug this default exists to prevent.
   */
  async list(
    user: KiksuRequestContext,
    termId?: string,
    state: EnrollmentState | "all" = "enrolled",
  ): Promise<EnrollmentDto[]> {
    const { sql } = this.db;
    const rows = await sql<Array<Record<string, unknown>>>`
      select ${this.columns()}
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = e.term_id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where e.app_user_id = ${user.appUserId}
         and (${termId ?? null}::uuid is null or e.term_id = ${termId ?? null}::uuid)
         and (${termId ?? null}::uuid is not null or t.is_current)
         and (${state}::text = 'all' or e.state::text = ${state}::text)
       order by e.display_order nulls last, c.code
    `;
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Enroll in a section.
   *
   * The section must belong to the caller's university — without that
   * predicate this endpoint is a way to enroll in, and therefore read the
   * timetable of, another campus's courses. The term is taken from the
   * section rather than from the client, so there is no way to ask for a
   * section in one term and have it recorded against another.
   */
  async create(user: KiksuRequestContext, input: CreateEnrollmentInput): Promise<EnrollmentDto> {
    const { sql } = this.db;

    const [section] = await sql<Array<{
      id: string; term_id: string; capacity: number | null;
      is_current: boolean; add_drop_open: boolean;
    }>>`
      select s.id, s.term_id, s.capacity, t.is_current,
             -- An add/drop deadline is optional in the schema; a term that
             -- does not set one stays open for the whole term.
             (t.add_drop_ends_on is null or t.add_drop_ends_on >= current_date) as add_drop_open
        from ref.course_section s
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = s.term_id
       where s.id = ${input.section_id}::uuid
         and c.university_id = ${user.univId}
         and c.is_active
    `;
    // Same 404 as a section that does not exist. A distinguishable "that
    // section is on another campus" would confirm the existence of a course
    // catalogue the caller cannot otherwise see.
    if (!section) throw new NotFoundException("section_not_found");

    if (!section.is_current || !section.add_drop_open) throw new AppError("term_closed");

    if (section.capacity !== null) {
      const [taken] = await sql<Array<{ n: number }>>`
        select count(*)::int as n from public.enrollment
         where section_id = ${section.id}::uuid and state = 'enrolled'
      `;
      if ((taken?.n ?? 0) >= section.capacity) throw new AppError("section_full");
    }

    // The upsert half of the soft-drop design: re-adding a dropped section
    // revives the original row, absence history and all, rather than minting a
    // clean one. `where enrollment.state <> 'enrolled'` makes a genuine
    // double-add fall through to zero rows so it can be reported as a conflict
    // rather than silently succeeding.
    const [row] = await sql<Array<{ id: string }>>`
      insert into public.enrollment (app_user_id, section_id, term_id, state, color)
      values (${user.appUserId}::uuid, ${section.id}::uuid, ${section.term_id}::uuid,
              'enrolled', ${input.color ?? "turquoise"}::public.accent_color)
      on conflict (app_user_id, section_id) do update
         set state = 'enrolled',
             color = coalesce(${input.color ?? null}::public.accent_color, public.enrollment.color),
             updated_at = now()
       where public.enrollment.state <> 'enrolled'
      returning id
    `;
    if (!row) throw new AppError("already_enrolled");

    return this.byId(user, row.id);
  }

  /** Colour, order, or an explicit state change. */
  async update(
    user: KiksuRequestContext,
    enrollmentId: string,
    input: UpdateEnrollmentInput,
  ): Promise<EnrollmentDto> {
    const { sql } = this.db;
    const [row] = await sql<Array<{ id: string }>>`
      update public.enrollment
         set color = coalesce(${input.color ?? null}::public.accent_color, color),
             display_order = coalesce(${input.display_order ?? null}::smallint, display_order),
             state = coalesce(${input.state ?? null}::public.enrollment_state, state),
             updated_at = now()
       where id = ${enrollmentId}::uuid
         and app_user_id = ${user.appUserId}::uuid
      returning id
    `;
    if (!row) throw new NotFoundException("enrollment_not_found");
    return this.byId(user, row.id);
  }

  /**
   * Drop. Soft, per the class comment: state moves to `dropped`, the row and
   * its absence history stay. 204 either way at the controller.
   */
  async drop(user: KiksuRequestContext, enrollmentId: string): Promise<void> {
    const { sql } = this.db;
    const [row] = await sql<Array<{ id: string }>>`
      update public.enrollment e
         set state = 'dropped', updated_at = now()
        from ref.term t
       where e.id = ${enrollmentId}::uuid
         and e.app_user_id = ${user.appUserId}::uuid
         and t.id = e.term_id
      returning e.id
    `;
    if (!row) throw new NotFoundException("enrollment_not_found");
  }

  /**
   * Sections of one course in a term, with their meetings.
   *
   * Enrollment, absence, timetable and coursework all hang off the SECTION, so
   * the picker has to choose one — a course alone is not something you can be
   * enrolled in. The meetings ride along because a student choosing between
   * section 1 and section 2 is choosing between two different weeks, and
   * making them enroll to find that out is the wrong order.
   *
   * `enrolled_count` comes from a live count rather than a counter cache: this
   * is a low-traffic picker, and a stale "38/40" that is really 40/40 sends a
   * student into a `section_full` error they were just told would not happen.
   */
  async sectionsForCourse(
    user: KiksuRequestContext,
    courseId: string,
    termId?: string,
  ): Promise<CourseSectionDto[]> {
    const { sql } = this.db;

    const [course] = await sql<Array<{ id: string }>>`
      select c.id from ref.course c
       where c.id = ${courseId}::uuid and c.university_id = ${user.univId} and c.is_active
    `;
    if (!course) throw new NotFoundException("course_not_found");

    const rows = await sql<Array<Record<string, unknown>>>`
      select s.id, s.section_code, s.capacity,
             (select count(*)::int from public.enrollment e2
               where e2.section_id = s.id and e2.state = 'enrolled') as enrolled_count,
             exists (select 1 from public.enrollment e3
                      where e3.section_id = s.id
                        and e3.app_user_id = ${user.appUserId}::uuid
                        and e3.state = 'enrolled') as is_enrolled,
             case when i.id is null then null
                  else coalesce(i.title_prefix || ' ', '') || i.full_name end as instructor_name,
             coalesce(
               (select jsonb_agg(jsonb_build_object(
                         'weekday', m.weekday,
                         'starts_at', to_char(m.starts_at, 'HH24:MI'),
                         'ends_at',   to_char(m.ends_at,   'HH24:MI'),
                         'kind',      m.kind::text,
                         'room',      r.code)
                       order by m.weekday, m.starts_at)
                  from ref.section_meeting m
                  left join ref.room r on r.id = m.room_id
                 where m.section_id = s.id),
               '[]'::jsonb) as meetings
        from ref.course_section s
        join ref.term t on t.id = s.term_id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where s.course_id = ${courseId}::uuid
         and (${termId ?? null}::uuid is null or s.term_id = ${termId ?? null}::uuid)
         and (${termId ?? null}::uuid is not null or t.is_current)
       order by s.section_code
    `;

    return rows.map((r) => ({
      id: r.id as string,
      section_code: r.section_code as string,
      capacity: r.capacity === null ? null : Number(r.capacity),
      enrolled_count: Number(r.enrolled_count ?? 0),
      instructor_name: (r.instructor_name as string) ?? null,
      is_enrolled: Boolean(r.is_enrolled),
      meetings: (r.meetings as CourseSectionDto["meetings"]) ?? [],
    }));
  }

  private async byId(user: KiksuRequestContext, id: string): Promise<EnrollmentDto> {
    const { sql } = this.db;
    const [row] = await sql<Array<Record<string, unknown>>>`
      select ${this.columns()}
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = e.term_id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where e.id = ${id}::uuid and e.app_user_id = ${user.appUserId}::uuid
    `;
    if (!row) throw new NotFoundException("enrollment_not_found");
    return this.toDto(row);
  }

  private columns() {
    return this.db.sql`
      e.id, e.section_id, e.term_id, e.state::text as state,
      e.color::text as color, e.display_order,
      e.absence_count, e.absence_units, e.absence_limit,
      e.final_letter, e.gpa_points,
      c.id as course_id, c.code, c.title_az as title, c.short_title, c.credits,
      s.section_code,
      case when i.id is null then null
           else coalesce(i.title_prefix || ' ', '') || i.full_name end as instructor_name
    `;
  }

  private toDto(r: Record<string, unknown>): EnrollmentDto {
    const limit = r.absence_limit === null ? 0 : Number(r.absence_limit);
    const used = Number(r.absence_count ?? 0);
    return {
      id: r.id as string,
      section_id: r.section_id as string,
      term_id: r.term_id as string,
      state: r.state as EnrollmentState,
      color: r.color as AccentColor,
      display_order: r.display_order === null ? null : Number(r.display_order),
      course: {
        id: r.course_id as string,
        code: r.code as string,
        title: r.title as string,
        short_title: (r.short_title as string) ?? null,
        credits: r.credits === null ? null : Number(r.credits),
      },
      section_code: r.section_code as string,
      instructor_name: (r.instructor_name as string) ?? null,
      // `absence_limit` is a nightly-refreshed snapshot and is null until that
      // job has seen the row. Reporting a ring against a limit of zero would
      // render every new enrollment as already expelled, so the whole block is
      // withheld until there is a real limit to compare against.
      attendance: limit > 0
        ? {
            section_id: r.section_id as string,
            course_code: r.code as string,
            course_title: r.title as string,
            absences: used,
            max_absences: limit,
            expulsion_at: limit,
            used_ratio: Math.round((used / limit) * 10_000) / 10_000,
            is_warning: used / limit >= 0.75,
            is_barred: used >= limit,
          }
        : null,
      final_letter: (r.final_letter as string) ?? null,
      gpa_points: r.gpa_points === null ? null : Number(r.gpa_points),
    };
  }
}
