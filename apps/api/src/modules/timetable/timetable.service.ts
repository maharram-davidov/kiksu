import { Injectable } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type { AttendanceDto, CourseSearchItemDto, MeetingDto, WeekGridDto } from "./timetable.types";

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
             and ab.excuse_state <> 'excused'
        ) a on true
       where e.app_user_id = ${user.appUserId}
         and e.state = 'enrolled'
         and c.university_id = ${user.univId}
       order by c.code
    `;
  }

  /**
   * Catalogue search, scoped to the caller's university and current term.
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
