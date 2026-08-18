import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import { ModerationService } from "../moderation/moderation.service";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type { Locale } from "../../common/locale/locale";
import type {
  InstructorProfileDto, ReviewAccessDto, ReviewDto, ReviewPageDto,
  ReviewableDto, ReviewTagDto,
} from "./reviews.types";

/** Write one review a term to read other people's prose. */
const REQUIRED_REVIEWS_PER_TERM = 1;

/**
 * Course and professor reviews.
 *
 * Two things make this module different from the forum:
 *
 * 1. NO AUTHOR IS EXPOSED, not even an ordinal. A course cohort is small
 *    enough that "Anonim 3, spring term" narrows to a handful of people, and
 *    a review is far more consequential to its author than a board comment.
 *
 * 2. THE CONTRIBUTION WALL gates free text but NOT aggregates. The histogram
 *    and criteria averages are visible to everyone, because a rating summary
 *    is what makes the wall worth climbing — gating everything would leave a
 *    student staring at a locked door with no reason to open it.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: SqlProvider,
    private readonly moderation: ModerationService,
  ) {}

  /**
   * How many reviews this caller has written this term.
   *
   * Counted through internal.review_author, which is the ONLY legitimate read
   * of that table in the product: it answers "how many did YOU write" for the
   * caller themselves, never "who wrote this".
   */
  private async access(user: KiksuRequestContext): Promise<ReviewAccessDto> {
    const [row] = await this.db.sql<Array<{ n: number }>>`
      select count(*)::int as n
        from internal.review_author ra
        join ref.term t on t.id = ra.term_id
       where ra.app_user_id = ${user.appUserId}
         and t.is_current
    `;
    const written = row?.n ?? 0;
    return {
      can_read_text: written >= REQUIRED_REVIEWS_PER_TERM,
      written_this_term: written,
      required_this_term: REQUIRED_REVIEWS_PER_TERM,
    };
  }

  async getInstructor(user: KiksuRequestContext, instructorId: string): Promise<InstructorProfileDto> {
    const { sql } = this.db;

    const [i] = await sql<Array<Record<string, unknown>>>`
      select i.id, i.full_name, i.title_prefix, d.name_az as department, u.code as university_code,
             coalesce(s.review_count, 0) as review_count,
             coalesce(s.course_count, 0) as course_count,
             s.rating_avg, s.star_1, s.star_2, s.star_3, s.star_4, s.star_5,
             s.quality_avg, s.fairness_avg, s.workload_avg, s.attendance_avg,
             coalesce(s.top_tags, '{}') as top_tags
        from ref.instructor i
        join ref.university u on u.id = i.university_id
        left join ref.department d on d.id = i.department_id
        left join public.instructor_review_summary s on s.instructor_id = i.id
       where i.id = ${instructorId}
         and i.university_id = ${user.univId}
    `;
    if (!i) throw new NotFoundException("instructor_not_found");

    const courses = await sql<Array<Record<string, unknown>>>`
      select c.id, c.code, c.title_az as title,
             cis.review_count, cis.rating_avg
        from public.course_instructor_review_summary cis
        join ref.course c on c.id = cis.course_id
       where cis.instructor_id = ${instructorId}
         and cis.review_count > 0
       order by cis.review_count desc
    `;

    // instructor_review_summary.top_tags is a materialised column filled by a
    // scheduled recompute that does not exist yet, so it is empty. Computing
    // the top three live costs one grouped scan of this instructor's reviews —
    // trivial at any realistic per-instructor count, and it means the profile
    // shows what the reviews actually say rather than what a job last wrote.
    // Move to the column when the recompute job lands.
    const topTagRows = await sql<Array<{ key: string; label: string; polarity: string }>>`
      select rt.key, rt.label_az as label, rt.polarity
        from public.review r
        cross join lateral unnest(r.tag_keys) as tk(key)
        join ref.review_tag rt on rt.key = tk.key and rt.is_active
       where r.instructor_id = ${instructorId}
         and r.moderation_state in ('visible', 'limited')
         and r.deleted_at is null
       group by rt.key, rt.label_az, rt.polarity, rt.display_order
       order by count(*) desc, rt.display_order
       limit 3
    `;

    return {
      id: i.id as string,
      full_name: i.full_name as string,
      title_prefix: (i.title_prefix as string) ?? null,
      department: (i.department as string) ?? null,
      university_code: i.university_code as string,
      review_count: Number(i.review_count),
      course_count: Number(i.course_count),
      rating_avg: i.rating_avg === null ? null : Number(i.rating_avg),
      histogram: [i.star_1, i.star_2, i.star_3, i.star_4, i.star_5].map((n) => Number(n ?? 0)),
      criteria: {
        quality: i.quality_avg === null ? null : Number(i.quality_avg),
        fairness: i.fairness_avg === null ? null : Number(i.fairness_avg),
        workload: i.workload_avg === null ? null : Number(i.workload_avg),
        attendance_strictness: i.attendance_avg === null ? null : Number(i.attendance_avg),
      },
      top_tags: topTagRows,
      courses: courses.map((c) => ({
        id: c.id as string,
        code: c.code as string,
        title: c.title as string,
        review_count: Number(c.review_count),
        rating_avg: c.rating_avg === null ? null : Number(c.rating_avg),
      })),
    };
  }

  /**
   * Written reviews for an instructor, optionally narrowed to one course.
   *
   * Returns 200 with an empty list and `can_read_text: false` when the caller
   * has not contributed, rather than 403. The wall is a prompt, not a refusal.
   */
  async listReviews(
    user: KiksuRequestContext, instructorId: string, courseId?: string,
  ): Promise<ReviewPageDto> {
    const access = await this.access(user);
    if (!access.can_read_text) return { access, items: [] };

    const { sql } = this.db;
    const rows = await sql<Array<Record<string, unknown>>>`
      select r.id, c.code as course_code, c.title_az as course_title,
             t.label as term_label, r.overall_rating, r.quality, r.fairness,
             r.workload, r.attendance_strictness, r.tag_keys, r.body,
             r.is_enrollment_verified, r.created_at
        from public.review r
        join ref.course c on c.id = r.course_id
        join ref.term t on t.id = r.term_id
       where r.instructor_id = ${instructorId}
         and r.university_id = ${user.univId}
         and r.moderation_state in ('visible', 'limited')
         and r.deleted_at is null
         and (${courseId ?? null}::uuid is null or r.course_id = ${courseId ?? null}::uuid)
         -- Free text only: a rating with no prose adds nothing to this list
         -- and the aggregates already counted it.
         and r.body is not null
       order by r.helpful_count desc, r.created_at desc
       limit 50
    `;

    const allTags = [...new Set(rows.flatMap((r) => (r.tag_keys as string[]) ?? []))];
    const tagMap = new Map((await this.resolveTags(allTags)).map((t) => [t.key, t]));

    return {
      access,
      items: rows.map<ReviewDto>((r) => ({
        id: r.id as string,
        course_code: r.course_code as string,
        course_title: r.course_title as string,
        term_label: r.term_label as string,
        overall_rating: Number(r.overall_rating),
        quality: Number(r.quality),
        fairness: Number(r.fairness),
        workload: Number(r.workload),
        attendance_strictness: Number(r.attendance_strictness),
        tags: ((r.tag_keys as string[]) ?? []).map((k) => tagMap.get(k)).filter(Boolean) as ReviewDto["tags"],
        body: (r.body as string) ?? null,
        is_enrollment_verified: r.is_enrollment_verified as boolean,
        created_at: (r.created_at as Date).toISOString(),
      })),
    };
  }

  /**
   * Writes a review. Structured ratings are required; prose is optional.
   *
   * That ordering is deliberate and it is what makes the feature survivable:
   * an average of numeric ratings is far harder to characterise as defamation
   * than a paragraph, and it is also the part that aggregates. The prose is
   * what students come for; the numbers are what the product can defend.
   */
  async createReview(
    user: KiksuRequestContext,
    input: {
      courseId: string; instructorId: string;
      overall: number; quality: number; fairness: number;
      workload: number; attendanceStrictness: number;
      tags: string[]; body?: string;
    },
  ): Promise<{ id: string; access: ReviewAccessDto }> {
    const id = await this.db.transaction(async (tx) => {
      const [term] = await tx<Array<{ id: string }>>`
        select id from ref.term where university_id = ${user.univId} and is_current`;
      if (!term) throw new BadRequestException("no_current_term");

      const [course] = await tx<Array<{ id: string }>>`
        select c.id from ref.course c
         where c.id = ${input.courseId} and c.university_id = ${user.univId}`;
      if (!course) throw new NotFoundException("course_not_found");

      // One review per course × instructor × term per person. Enforced by the
      // unique constraint on internal.review_author, not by this check — the
      // check is only here to turn a constraint violation into a clean error.
      const [existing] = await tx<Array<{ review_id: string }>>`
        select review_id from internal.review_author
         where app_user_id = ${user.appUserId}
           and course_id = ${input.courseId}
           and instructor_id = ${input.instructorId}
           and term_id = ${term.id}`;
      if (existing) throw new BadRequestException("review_already_written");

      // Was the caller actually enrolled? Drives the design's DOĞRULANMIŞ
      // badge. Not a gate: someone who dropped the course still has a view
      // worth hearing, it just carries less weight.
      const [enrolled] = await tx<Array<{ n: number }>>`
        select 1 as n from public.enrollment e
          join ref.course_section s on s.id = e.section_id
         where e.app_user_id = ${user.appUserId}
           and s.course_id = ${input.courseId}
           and s.term_id = ${term.id}
         limit 1`;

      const [row] = await tx<Array<{ id: string }>>`
        insert into public.review
          (university_id, course_id, instructor_id, term_id, overall_rating,
           quality, fairness, workload, attendance_strictness, tag_keys, body,
           is_enrollment_verified)
        values (${user.univId}, ${input.courseId}, ${input.instructorId}, ${term.id},
                ${input.overall}, ${input.quality}, ${input.fairness}, ${input.workload},
                ${input.attendanceStrictness}, ${input.tags}, ${input.body ?? null},
                ${Boolean(enrolled)})
        returning id
      `;
      if (!row) throw new BadRequestException("review_failed");

      // Authorship to internal, in the same transaction, exactly as posts do.
      await tx`
        insert into internal.review_author (review_id, app_user_id, course_id, instructor_id, term_id)
        values (${row.id}, ${user.appUserId}, ${input.courseId}, ${input.instructorId}, ${term.id})
      `;

      // Reviews are free text about a NAMED person, so they get the same
      // automated pass as forum content and arguably need it more.
      const state = await this.moderation.classifyOnWrite(tx, {
        targetType: "review", targetId: row.id,
        universityId: user.univId, body: input.body ?? null,
      });
      if (state !== "visible") {
        await tx`update public.review set moderation_state = ${state}::public.moderation_state
                  where id = ${row.id}`;
      }

      return row.id;
    });

    return { id, access: await this.access(user) };
  }

  /**
   * The tag vocabulary the composer renders as chips.
   *
   * Closed by design — `POST /reviews` answers `review_tag_unknown` (422) to
   * anything not in here, so this endpoint is not a convenience but the only
   * way a client can write the tag half of a review at all.
   *
   * `label_ru` is nullable in `ref.review_tag` and unset in the seed, so a
   * Russian caller currently falls back to Azerbaijani rather than seeing an
   * empty chip. That fallback is correct behaviour permanently; the missing
   * Russian labels are a copy gap, not a code one, and belong with the same
   * native reviewer the handle wordlist is waiting on.
   */
  async listTags(locale: Locale): Promise<ReviewTagDto[]> {
    const column =
      locale === "ru" ? this.db.sql`label_ru` :
      locale === "en" ? this.db.sql`label_en` :
      this.db.sql`label_az`;

    return this.db.sql<ReviewTagDto[]>`
      select key,
             coalesce(${column}, label_az) as label,
             polarity,
             applies_to
        from ref.review_tag
       where is_active
       order by display_order, key
    `;
  }

  /**
   * What the caller can review this term: their own enrollments, minus what
   * they have already written.
   *
   * The instructor profile cannot drive the composer, because its `courses`
   * list is filtered to courses that already HAVE reviews. An instructor with
   * none would offer an empty picker — which is exactly the cold-start case
   * the contribution wall exists to break, so the composer has to be driven
   * from the student's timetable instead.
   *
   * Campus-scoped explicitly. The pool is BYPASSRLS (see SqlProvider), so a
   * missing university predicate here would be a cross-campus data leak rather
   * than a slow query — and this one joins enrollment, which is personal.
   */
  async listReviewable(user: KiksuRequestContext): Promise<ReviewableDto[]> {
    return this.db.sql<ReviewableDto[]>`
      select distinct
             c.id            as course_id,
             c.code          as course_code,
             c.title_az      as course_title,
             i.id            as instructor_id,
             trim(coalesce(i.title_prefix, '') || ' ' || i.full_name) as instructor_name,
             t.label         as term_label
        from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c         on c.id = s.course_id
        join ref.term t           on t.id = s.term_id
        -- Who teaches a section is recorded in TWO places and only one of them
        -- is currently populated: every section carries
        -- primary_instructor_id, while the many-to-many ref.section_instructor
        -- exists in the schema and has no rows in any seed. Reading only the
        -- latter returns nothing at all, which is what the first version of
        -- this query did.
        --
        -- Both are unioned rather than picking one, so this keeps working when
        -- section_instructor does start being filled — a course with a
        -- separate lab instructor has someone worth reviewing who is not the
        -- primary lecturer.
        --
        -- 'guest' is excluded deliberately: a one-off guest lecturer has no
        -- body of teaching to review, and offering them would put a named
        -- person in front of a rating form on the strength of one appearance.
        join lateral (
          select s.primary_instructor_id as instructor_id
           where s.primary_instructor_id is not null
          union
          select si.instructor_id
            from ref.section_instructor si
           where si.section_id = s.id and si.role <> 'guest'
        ) taught on true
        join ref.instructor i     on i.id = taught.instructor_id
       where e.app_user_id = ${user.appUserId}
         and c.university_id = ${user.univId}
         and t.is_current
         -- Already written for this course x instructor x term. The unique
         -- constraint on internal.review_author would reject a second one
         -- anyway; excluding it here means the composer never offers a choice
         -- that is going to fail.
         and not exists (
           select 1 from internal.review_author ra
            where ra.app_user_id = ${user.appUserId}
              and ra.course_id = c.id
              and ra.instructor_id = i.id
              and ra.term_id = t.id
         )
       order by c.code, instructor_name
    `;
  }

  private async resolveTags(keys: string[]): Promise<Array<{ key: string; label: string; polarity: string }>> {
    if (keys.length === 0) return [];
    return this.db.sql<Array<{ key: string; label: string; polarity: string }>>`
      select key, label_az as label, polarity
        from ref.review_tag
       where key = any (${keys}) and is_active
       order by display_order
    `;
  }
}
