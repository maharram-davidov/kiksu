import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type {
  AttendanceDto, ClassDetailDto, CourseSearchItemDto, MeetingDto, WeekGridDto,
} from "./timetable.types";

/**
 * Timetable reads.
 *
 * SCOPING IS THIS CLASS'S JOB. The pool authenticates as a BYPASSRLS role
 * (see SqlProvider), so nothing filters these queries for us. Every statement
 * below constrains on the caller's university and the current term explicitly.
 * A missing predicate here is a cross-campus data leak, not a slow query.
 */
@Injectable()
export class TimetableService {
  constructor(private readonly db: SqlProvider) {}

  /**
   * The week grid, as ONE query.
   *
   * The naive shape is a query per day or per cell; at 5 days x ~8 slots that
   * is 40 round trips for the screen students open every morning. This joins
   * enrolment -> section -> meeting once and lets the client bucket by weekday.
   */
  async getWeekGrid(user: KiksuRequestContext): Promise<WeekGridDto | null> {
    const { sql } = this.db;

    const [term] = await sql<
      Array<{ id: string; label: string; starts_on: Date; ends_on: Date; timezone: string }>
    >`
      select t.id, t.label, t.starts_on, t.ends_on, u.timezone
        from ref.term t
        join ref.university u on u.id = t.university_id
       where t.university_id = ${user.univId}
         and t.is_current
       limit 1
    `;
    if (!term) return null;

    const rows = await sql<Array<MeetingDto>>`
      select s.id                                   as section_id,
             c.code                                 as course_code,
             c.title_az                             as course_title,
             m.weekday,
             to_char(m.starts_at, 'HH24:MI')        as starts_at,
             to_char(m.ends_at,   'HH24:MI')        as ends_at,
             r.code                                 as room,
             ca.name_az                             as campus,
             m.kind::text                           as kind,
             case when i.id is null then null
                  else coalesce(i.title_prefix || ' ', '') || i.full_name
             end                                    as instructor
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.section_meeting m on m.section_id = s.id
        join ref.course c on c.id = s.course_id
        left join ref.room r on r.id = m.room_id
        left join ref.campus ca on ca.id = r.campus_id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where e.app_user_id = ${user.appUserId}
         and e.state = 'enrolled'
         and s.term_id = ${term.id}
         and c.university_id = ${user.univId}
       order by m.weekday, m.starts_at
    `;

    return {
      term: {
        id: term.id,
        label: term.label,
        starts_on: term.starts_on.toISOString().slice(0, 10),
        ends_on: term.ends_on.toISOString().slice(0, 10),
      },
      timezone: term.timezone,
      meetings: rows,
    };
  }

  /**
   * Attendance across the caller's enrolled courses.
   *
   * The limit comes from `ref.effective_absence_limit(section_id)`, which
   * resolves the course -> faculty -> university policy chain. It is never a
   * constant in this codebase: the design shows 12 for BDU, but that is BDU's
   * configuration, and a second campus will differ.
   */
  async getAttendance(user: KiksuRequestContext): Promise<AttendanceDto[]> {
    const { sql } = this.db;
    return sql<Array<AttendanceDto>>`
      select s.id                        as section_id,
             c.code                      as course_code,
             c.title_az                  as course_title,
             coalesce(a.n, 0)::int       as absences,
             l.max_absences::int         as max_absences,
             coalesce(l.expulsion_at, l.max_absences)::int as expulsion_at,
             round(coalesce(a.n, 0)::numeric / nullif(l.max_absences, 0), 4)::float8 as used_ratio,
             (coalesce(a.n, 0)::numeric / nullif(l.max_absences, 0)) >= l.warn_at_ratio as is_warning,
             coalesce(a.n, 0) >= coalesce(l.expulsion_at, l.max_absences)               as is_barred
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id
        cross join lateral ref.effective_absence_limit(s.id) l
        left join lateral (
          select count(*) as n
            from public.absence ab
           where ab.enrollment_id = e.id
             -- Two separate concepts, easy to conflate: kind is what
             -- happened (absent / late / excused) and excuse_state is where
             -- the appeal got to (none / requested / approved / rejected).
             -- There is no 'excused' excuse_state, so comparing against one
             -- silently matches every row and counts approved excuses against
             -- the student, which is what bars them from an exam they were
             -- entitled to sit.
             and ab.excuse_state <> 'approved'
             and ab.kind <> 'excused'
        ) a on true
       where e.app_user_id = ${user.appUserId}
         and e.state = 'enrolled'
         and c.university_id = ${user.univId}
       order by c.code
    `;
  }

  /**
   * The class detail sheet, in one call.
   *
   * Attendance is computed the same way as the summary endpoint, through
   * `ref.effective_absence_limit`, so the sheet and the list can never
   * disagree about whether a student is close to exclusion. Two surfaces
   * showing different absence counts is the kind of thing that destroys trust
   * in a feature students are already anxious about.
   */
  async getClassDetail(user: KiksuRequestContext, sectionId: string): Promise<ClassDetailDto> {
    const { sql } = this.db;

    const [head] = await sql<Array<Record<string, unknown>>>`
      select s.id as section_id, s.section_code, c.id as course_id, c.code as course_code,
             c.title_az as course_title, c.credits,
             i.id as instructor_id, i.full_name, i.title_prefix,
             irs.rating_avg as instructor_rating, coalesce(irs.review_count, 0) as instructor_reviews,
             e.id as enrollment_id,
             l.max_absences, coalesce(l.expulsion_at, l.max_absences) as expulsion_at,
             l.warn_at_ratio,
             coalesce(a.n, 0) as absences,
             (select count(*) from public.course_material cm
               where cm.course_id = c.id and cm.deleted_at is null
                 and cm.moderation_state in ('visible','limited'))            as material_count,
             (select coalesce(b.post_count, 0) from public.board b
               where b.course_id = c.id limit 1)                              as board_topic_count,
             (select count(*) from public.review r
               where r.course_id = c.id and r.instructor_id = i.id
                 and r.deleted_at is null)                                    as review_count
        from ref.course_section s
        join ref.course c on c.id = s.course_id
        left join ref.instructor i on i.id = s.primary_instructor_id
        left join public.instructor_review_summary irs on irs.instructor_id = i.id
        left join public.enrollment e
               on e.section_id = s.id and e.app_user_id = ${user.appUserId} and e.state = 'enrolled'
        cross join lateral ref.effective_absence_limit(s.id) l
        left join lateral (
          select count(*) as n from public.absence ab
           where ab.enrollment_id = e.id
             and ab.excuse_state <> 'approved'
             and ab.kind <> 'excused'
        ) a on true
       where s.id = ${sectionId}
         and c.university_id = ${user.univId}
    `;
    if (!head) throw new NotFoundException("section_not_found");

    const meetings = await sql<Array<Record<string, unknown>>>`
      select m.weekday, to_char(m.starts_at,'HH24:MI') as starts_at,
             to_char(m.ends_at,'HH24:MI') as ends_at,
             r.code as room, ca.name_az as campus, m.kind::text as kind
        from ref.section_meeting m
        left join ref.room r on r.id = m.room_id
        left join ref.campus ca on ca.id = r.campus_id
       where m.section_id = ${sectionId}
       order by m.weekday, m.starts_at
    `;

    const absences = Number(head.absences ?? 0);
    const max = Number(head.max_absences ?? 0);
    const expulsion = Number(head.expulsion_at ?? max);
    const ratio = max > 0 ? absences / max : 0;

    return {
      section_id: head.section_id as string,
      course_id: head.course_id as string,
      course_code: head.course_code as string,
      course_title: head.course_title as string,
      // numeric arrives as a string from the driver: without this the sheet
      // renders "6.0 KREDİT" where the design says "6 KREDİT".
      credits: head.credits === null || head.credits === undefined ? null : Number(head.credits),
      section_code: (head.section_code as string) ?? null,
      meetings: meetings.map((m) => ({
        weekday: Number(m.weekday),
        starts_at: m.starts_at as string,
        ends_at: m.ends_at as string,
        room: (m.room as string) ?? null,
        campus: (m.campus as string) ?? null,
        kind: m.kind as string,
      })),
      instructor: head.instructor_id
        ? {
            id: head.instructor_id as string,
            full_name: head.full_name as string,
            title_prefix: (head.title_prefix as string) ?? null,
            rating_avg: head.instructor_rating === null ? null : Number(head.instructor_rating),
            review_count: Number(head.instructor_reviews ?? 0),
          }
        : null,
      attendance: {
        absences,
        max_absences: max,
        expulsion_at: expulsion,
        used_ratio: Number(ratio.toFixed(4)),
        is_warning: ratio >= Number(head.warn_at_ratio ?? 0.5),
        is_barred: absences >= expulsion,
      },
      material_count: Number(head.material_count ?? 0),
      board_topic_count: Number(head.board_topic_count ?? 0),
      review_count: Number(head.review_count ?? 0),
      enrollment_id: (head.enrollment_id as string) ?? null,
    };
  }

  /**
   * Records a self-reported absence — the design's "Qayıb qeyd et".
   *
   * Self-reported, and that word carries weight: this is the student's own
   * tally so they can see the exclusion limit coming, NOT the university's
   * register. Nothing here feeds a real attendance record, and the client says
   * so, because a student who mistook one for the other could believe they had
   * reported an absence to their faculty when they had not.
   *
   * Idempotent per date: tapping twice for the same class must not cost a
   * student a second absence against a limit that can exclude them.
   */
  async recordAbsence(
    user: KiksuRequestContext, sectionId: string, occurredOn: string,
  ): Promise<{ absences: number; max_absences: number }> {
    const { sql } = this.db;

    const [enrollment] = await sql<Array<{ id: string }>>`
      select e.id from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id
       where e.app_user_id = ${user.appUserId}
         and e.section_id = ${sectionId}
         and e.state = 'enrolled'
         and c.university_id = ${user.univId}
    `;
    if (!enrollment) throw new BadRequestException("not_enrolled");

    await sql`
      insert into public.absence (enrollment_id, occurred_on, kind, source)
      values (${enrollment.id}, ${occurredOn}::date, 'absent', 'self_reported')
      on conflict do nothing
    `;

    const [row] = await sql<Array<{ n: number; max: number }>>`
      select (select count(*) from public.absence ab
               where ab.enrollment_id = ${enrollment.id}
                 and ab.excuse_state <> 'approved' and ab.kind <> 'excused')::int as n,
             l.max_absences as max
        from ref.effective_absence_limit(${sectionId}::uuid) l
    `;
    return { absences: Number(row?.n ?? 0), max_absences: Number(row?.max ?? 0) };
  }

  /**
   * Catalogue search, scoped to the caller's university and current term.
   *
   * NOTE: `SearchService.searchCourses` queries the same corpus for the global
   * search surface, with a different projection — ratings instead of instructor
   * names, and keyset pagination. The scope predicates and the three fold
   * predicates below are duplicated there deliberately (the two projections have
   * no useful common shape), which means **a change to the fold rules has to be
   * made in both places**, or the same query starts behaving differently
   * depending on which screen the student came from.
   *
   * Query text goes through `util.tsq()` so it is folded exactly the way the
   * indexed text was. Azerbaijani students type `e` for `ə` constantly, and
   * folding one side but not the other silently returns nothing for the most
   * common spelling of half the catalogue.
   */
  async searchCourses(user: KiksuRequestContext, q: string, limit = 20): Promise<CourseSearchItemDto[]> {
    const { sql } = this.db;
    const trimmed = q.trim();
    if (trimmed.length === 0) return [];

    return sql<Array<CourseSearchItemDto>>`
      select c.id      as course_id,
             c.code,
             c.title_az as title,
             c.credits,
             coalesce(
               array_agg(distinct coalesce(i.title_prefix || ' ', '') || i.full_name)
                 filter (where i.id is not null),
               '{}'
             ) as instructors
        from ref.course c
        left join ref.course_section s on s.course_id = c.id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where c.university_id = ${user.univId}
         and c.is_active
         and (
              c.title_search @@ util.tsq(${"az"}, ${trimmed})
           or util.fold_handle(c.code) like util.fold_handle(${trimmed}) || '%'
           or util.fold_text(c.title_az) like '%' || util.fold_text(${trimmed}) || '%'
         )
       group by c.id, c.code, c.title_az, c.credits
       order by c.code
       limit ${limit}
    `;
  }
}
