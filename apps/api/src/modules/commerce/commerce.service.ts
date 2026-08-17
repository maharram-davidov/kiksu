import { Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type { ListingDto, VacancyDto } from "./commerce.types";

/**
 * Marketplace and vacancy reads.
 *
 * Scoping, as everywhere: the pool is BYPASSRLS, so each query states its own
 * campus predicate. Listings are campus-scoped. Vacancies are NOT — a job in
 * Baku is open to any student, and `target_university_ids` narrows it only
 * when an employer says so.
 */
@Injectable()
export class CommerceService {
  constructor(private readonly db: SqlProvider) {}

  /**
   * The columns both the list and the detail select.
   *
   * Shared so the two cannot drift: a seller card that showed a rating on the
   * list and not on the detail would look like a bug in the seller, not in us.
   */
  private listingColumns() {
    return this.db.sql`
      l.id, l.title, l.description, cat.key as category_key, cat.name_az as category_name,
      l.price_minor, l.currency, l.is_negotiable, l.condition::text as condition,
      l.meetup_notes, crs.code as related_course_code, l.published_at,
      s.handle, s.avatar_id, su.code as seller_university_code,
      s.verification_tier::text as seller_tier,
      s.trade_rating_avg, s.deal_count, s.response_rate_pct,
      s.response_time_median_sec, s.complaint_count
    `;
  }

  async listListings(user: KiksuRequestContext, category?: string): Promise<ListingDto[]> {
    const { sql } = this.db;
    const rows = await sql<Array<Record<string, unknown>>>`
      select l.id, l.title, l.description, cat.key as category_key, cat.name_az as category_name,
             l.price_minor, l.currency, l.is_negotiable, l.condition::text as condition,
             l.meetup_notes, crs.code as related_course_code, l.published_at,
             -- Seller: the pseudonymous-but-persistent shape. Reads through
             -- public_profiles-equivalent columns only; never auth_user_id,
             -- never karma, never created_at.
             s.handle, s.avatar_id, su.code as seller_university_code,
             s.verification_tier::text as seller_tier,
             s.trade_rating_avg, s.deal_count, s.response_rate_pct,
             s.response_time_median_sec, s.complaint_count
        from public.listing l
        join ref.marketplace_category cat on cat.id = l.category_id
        left join ref.course crs on crs.id = l.related_course_id
        left join public.app_user s on s.id = l.seller_id
        left join ref.university su on su.id = s.university_id
       where l.university_id = ${user.univId}
         and l.status in ('active', 'reserved')
         and l.moderation_state in ('visible', 'limited')
         and l.deleted_at is null
         and (${category ?? null}::text is null or cat.key = ${category ?? null})
       order by l.bumped_at desc nulls last, l.published_at desc
       limit 50
    `;
    return rows.map((r) => this.toListing(r));
  }

  /**
   * One listing.
   *
   * A real single-row query rather than a scan of the list. The earlier
   * shortcut — fetch the first 50 and find one — would 404 any listing past
   * the 50th, which is a bug that only appears once the marketplace is busy
   * enough to matter and looks like the listing was deleted.
   */
  async getListing(user: KiksuRequestContext, id: string): Promise<ListingDto> {
    const { sql } = this.db;
    const [row] = await sql<Array<Record<string, unknown>>>`
      select ${this.listingColumns()}
        from public.listing l
        join ref.marketplace_category cat on cat.id = l.category_id
        left join ref.course crs on crs.id = l.related_course_id
        left join public.app_user s on s.id = l.seller_id
        left join ref.university su on su.id = s.university_id
       where l.id = ${id}
         and l.university_id = ${user.univId}
         and l.status in ('active', 'reserved', 'sold')
         and l.moderation_state in ('visible', 'limited')
         and l.deleted_at is null
    `;
    if (!row) throw new NotFoundException("listing_not_found");
    return this.toListing(row);
  }

  async listVacancies(user: KiksuRequestContext, kind?: string): Promise<VacancyDto[]> {
    const { sql } = this.db;
    return sql<VacancyDto[]>`
      select v.id, v.title, v.description, v.kind::text as kind,
             v.work_mode::text as work_mode, v.city, v.is_paid, v.stipend_minor,
             v.currency, v.duration_months, v.hours_per_week,
             v.min_study_year, v.max_study_year, v.required_skills,
             v.conversion_possible, v.transport_provided, v.schedule_friendly,
             v.apply_deadline,
             case when v.apply_deadline is null then null
                  else greatest(0, (v.apply_deadline::date - current_date))::int end as days_left,
             jsonb_build_object(
               'slug', e.slug, 'name', e.name,
               'logo_initials', e.logo_initials, 'brand_color', e.brand_color
             ) as employer
        from public.vacancy v
        join public.employer e on e.id = v.employer_id
       where v.status = 'active'
         and e.is_active
         and (v.apply_deadline is null or v.apply_deadline >= now())
         -- Open to everyone unless the employer targeted specific campuses.
         and (v.target_university_ids is null
              or cardinality(v.target_university_ids) = 0
              or ${user.univId} = any (v.target_university_ids))
         and (${kind ?? null}::text is null or v.kind::text = ${kind ?? null})
       order by v.apply_deadline nulls last, v.posted_at desc
       limit 50
    `;
  }

  private toListing(r: Record<string, unknown>): ListingDto {
    const tier = r.seller_tier as string | null;
    return {
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string) ?? null,
      category_key: r.category_key as string,
      category_name: r.category_name as string,
      price_minor: r.price_minor as number,
      currency: r.currency as string,
      is_negotiable: r.is_negotiable as boolean,
      condition: r.condition as string,
      meetup_notes: (r.meetup_notes as string[]) ?? [],
      related_course_code: (r.related_course_code as string) ?? null,
      published_at: (r.published_at as Date).toISOString(),
      seller: r.handle
        ? {
            handle: r.handle as string,
            avatar_id: (r.avatar_id as number) ?? 0,
            university_code: (r.seller_university_code as string) ?? null,
            verification_status:
              tier === "card_verified" ? "card" : tier === "email_verified" ? "email" : "none",
            trade_rating_avg: r.trade_rating_avg === null ? null : Number(r.trade_rating_avg),
            deal_count: (r.deal_count as number) ?? 0,
            response_rate_pct: (r.response_rate_pct as number) ?? null,
            response_time_median_sec: (r.response_time_median_sec as number) ?? null,
            complaint_count: (r.complaint_count as number) ?? 0,
          }
        : null,
    };
  }
}
