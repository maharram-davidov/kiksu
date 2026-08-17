import { Injectable } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type {
  TodayClassDto, TodayDeadlineDto, TodayDto, TodayPostDto,
} from "./today.types";

/**
 * The landing screen's data, in one round trip.
 *
 * This is the screen students open every morning, often on campus wifi, so it
 * is deliberately one call rather than three. Everything below is scoped to
 * the caller's university explicitly — the pool is BYPASSRLS and nothing
 * filters for us.
 *
 * TIME IS COMPUTED IN THE UNIVERSITY'S ZONE, NOT THE SERVER'S OR THE PHONE'S.
 * Meeting times are `time` values interpreted in `ref.university.timezone`, so
 * "what is left today" has to be asked in that zone. Using the server's clock
 * would break the moment the API is deployed outside Baku; using the phone's
 * would break for any student who has travelled.
 */
@Injectable()
export class TodayService {
  constructor(private readonly db: SqlProvider) {}

  async getToday(user: KiksuRequestContext): Promise<TodayDto> {
    const { sql } = this.db;

    const [clock] = await sql<Array<{ tz: string; local_date: string; weekday: number }>>`
      select u.timezone                                              as tz,
             (now() at time zone u.timezone)::date::text             as local_date,
             extract(isodow from (now() at time zone u.timezone))::int as weekday
        from ref.university u
       where u.id = ${user.univId}
    `;
    const tz = clock?.tz ?? "Asia/Baku";

    const remaining = await sql<TodayClassDto[]>`
      select s.id                            as section_id,
             c.code                          as course_code,
             c.title_az                      as course_title,
             to_char(m.starts_at, 'HH24:MI') as starts_at,
             to_char(m.ends_at,   'HH24:MI') as ends_at,
             r.code                          as room,
             ca.name_az                      as campus,
             case when i.id is null then null
                  else coalesce(i.title_prefix || ' ', '') || i.full_name end as instructor,
             -- Minutes from "now, in the university's zone" to the class start.
             (extract(epoch from (m.starts_at - (now() at time zone u.timezone)::time)) / 60)::int
                                             as starts_in_minutes,
             ((now() at time zone u.timezone)::time between m.starts_at and m.ends_at)
                                             as is_in_progress
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.section_meeting m on m.section_id = s.id
        join ref.course c on c.id = s.course_id
        join ref.university u on u.id = c.university_id
        left join ref.room r on r.id = m.room_id
        left join ref.campus ca on ca.id = r.campus_id
        left join ref.instructor i on i.id = s.primary_instructor_id
       where e.app_user_id = ${user.appUserId}
         and e.state = 'enrolled'
         and c.university_id = ${user.univId}
         and m.weekday = extract(isodow from (now() at time zone u.timezone))::int
         -- Still to come, or running right now. A class that finished an hour
         -- ago is not something the landing screen should lead with.
         and m.ends_at >= (now() at time zone u.timezone)::time
       order by m.starts_at
    `;

    const deadlines = await sql<TodayDeadlineDto[]>`
      select cw.id, cw.title, c.code as course_code,
             cw.due_at,
             greatest(0, (cw.due_at::date - (now() at time zone u.timezone)::date))::int as days_left
        from public.coursework cw
        join ref.course_section s on s.id = cw.section_id
        join ref.course c on c.id = s.course_id
        join ref.university u on u.id = c.university_id
        join public.enrollment e on e.section_id = s.id and e.app_user_id = ${user.appUserId}
       where e.state = 'enrolled'
         and c.university_id = ${user.univId}
         and cw.due_at >= now()
         and cw.due_at < now() + interval '14 days'
       order by cw.due_at
       limit 5
    `;

    const hot = await sql<TodayPostDto[]>`
      select p.id, p.title, b.name_az as board_name, b.slug as board_slug,
             p.score, p.comment_count
        from public.post p
        join public.board b on b.id = p.board_id
       where p.moderation_state in ('visible', 'limited')
         and p.deleted_at is null
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.is_archived = false
       order by p.score desc, p.created_at desc
       limit 5
    `;

    return {
      date: clock?.local_date ?? "",
      weekday: clock?.weekday ?? 1,
      timezone: tz,
      remaining_classes: remaining,
      deadlines,
      hot_posts: hot,
    };
  }
}
