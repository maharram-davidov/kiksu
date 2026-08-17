import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { canChangeHandle, generateHandle } from "../onboarding/handle-generator";

/**
 * How long a released handle stays unavailable. The identity spec proposes 365
 * days; a year is long enough that nobody remembers the previous holder, and
 * the namespace is large enough (92k) to afford it.
 */
const HANDLE_QUARANTINE_DAYS = 365;

export interface MyProfileDto {
  handle: string;
  avatar_id: number;
  /** Exact, because this is the caller's OWN row. Never exposed cross-user. */
  karma: number;
  post_count: number;
  comment_count: number;
  review_count: number;
  trade_rating_avg: number | null;
  deal_count: number;
  verification_tier: string;
  /** The design's "KART: GÖZLƏYİR" — a card submitted and awaiting review. */
  card_review_state: string;
  university_code: string | null;
  study_year: number | null;
  handle_change_allowed_at: string;
  can_change_handle: boolean;
  privacy: {
    show_year: boolean;
    share_timetable: boolean;
    show_uni_badge: boolean;
    link_listings: boolean;
    discoverable: boolean;
  };
}

/**
 * The caller's own profile and privacy controls.
 *
 * This is the ONE place exact karma, counts and verification state are served,
 * and it works because every query here is keyed on the caller's own id. The
 * cross-user shape is `public_profiles`, which carries none of it — see
 * schema section 20 and the karma-delta oracle it closes.
 */
@Injectable()
export class MeService {
  constructor(private readonly db: SqlProvider) {}

  async getProfile(user: KiksuRequestContext): Promise<MyProfileDto> {
    const [row] = await this.db.sql<Array<Record<string, unknown>>>`
      select au.handle, au.avatar_id, au.karma, au.post_count, au.comment_count,
             au.review_count, au.trade_rating_avg, au.deal_count,
             au.verification_tier::text as verification_tier,
             au.card_review_state::text as card_review_state,
             au.display_study_year, au.handle_change_allowed_at, au.handle_changed_at,
             au.privacy_show_year, au.privacy_share_timetable, au.privacy_show_uni_badge,
             au.privacy_link_listings, au.privacy_discoverable,
             u.code as university_code
        from public.app_user au
        left join ref.university u on u.id = au.university_id
       where au.id = ${user.appUserId}
    `;
    if (!row) throw new NotFoundException("profile_not_found");

    return {
      handle: row.handle as string,
      avatar_id: (row.avatar_id as number) ?? 0,
      karma: Number(row.karma ?? 0),
      post_count: Number(row.post_count ?? 0),
      comment_count: Number(row.comment_count ?? 0),
      review_count: Number(row.review_count ?? 0),
      trade_rating_avg: row.trade_rating_avg === null ? null : Number(row.trade_rating_avg),
      deal_count: Number(row.deal_count ?? 0),
      verification_tier: row.verification_tier as string,
      card_review_state: row.card_review_state as string,
      university_code: (row.university_code as string) ?? null,
      study_year: (row.display_study_year as number) ?? null,
      handle_change_allowed_at: (row.handle_change_allowed_at as Date).toISOString(),
      can_change_handle: canChangeHandle(row.handle_changed_at as Date),
      privacy: {
        show_year: row.privacy_show_year as boolean,
        share_timetable: row.privacy_share_timetable as boolean,
        show_uni_badge: row.privacy_show_uni_badge as boolean,
        link_listings: row.privacy_link_listings as boolean,
        discoverable: row.privacy_discoverable as boolean,
      },
    };
  }

  /** Updates only the flags supplied; anything omitted is left alone. */
  async updatePrivacy(
    user: KiksuRequestContext,
    p: Partial<{
      show_year: boolean; share_timetable: boolean; show_uni_badge: boolean;
      link_listings: boolean; discoverable: boolean;
    }>,
  ): Promise<MyProfileDto> {
    await this.db.sql`
      update public.app_user
         set privacy_show_year       = coalesce(${p.show_year ?? null}, privacy_show_year),
             privacy_share_timetable = coalesce(${p.share_timetable ?? null}, privacy_share_timetable),
             privacy_show_uni_badge  = coalesce(${p.show_uni_badge ?? null}, privacy_show_uni_badge),
             privacy_link_listings   = coalesce(${p.link_listings ?? null}, privacy_link_listings),
             privacy_discoverable    = coalesce(${p.discoverable ?? null}, privacy_discoverable),
             updated_at = now()
       where id = ${user.appUserId}
    `;
    return this.getProfile(user);
  }

  /**
   * Rotates the handle, subject to the design's 14-day cooldown.
   *
   * The new handle is GENERATED, not chosen — the same rule as at signup, and
   * for the same reason. Letting someone pick on rotation would defeat the
   * point: they would carry a name they already use elsewhere.
   *
   * `internal.handle_history` models TENANCY, not a change log: each row is a
   * handle a person held, with when they took it and when they gave it up.
   * Two things fall out of that, and both matter:
   *
   *   - Blocks and sanctions can be resolved through a released handle, so
   *     renaming is not an escape hatch.
   *   - A released handle is QUARANTINED rather than immediately free. Handing
   *     `sakit-pərvanə-37` to someone else the day after its owner dropped it
   *     would let a stranger inherit a reputation, or impersonate one — the
   *     identity spec's reason for a long quarantine.
   */
  async rotateHandle(user: KiksuRequestContext): Promise<{ handle: string }> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx<Array<{ handle: string; handle_changed_at: Date }>>`
        select handle, handle_changed_at from public.app_user
         where id = ${user.appUserId} for update`;
      if (!current) throw new NotFoundException("profile_not_found");

      if (!canChangeHandle(current.handle_changed_at)) {
        throw new BadRequestException("handle_change_too_soon");
      }

      const next = await generateHandle(async (candidate) => {
        // Taken if live, OR released within the quarantine window. A handle
        // that just changed hands would otherwise let a stranger inherit its
        // reputation.
        const [taken] = await tx`
          select 1 where exists (
            select 1 from public.app_user where handle = ${candidate}
          ) or exists (
            select 1 from internal.handle_history
             where handle = ${candidate}
               and released_at is not null
               and released_at > now() - ${`${HANDLE_QUARANTINE_DAYS} days`}::interval
          )`;
        return Boolean(taken);
      });

      // Close out the tenancy on the handle being given up. If no live row
      // exists — an account provisioned before tenancies were recorded — open
      // and close one now, so the history is complete rather than starting
      // from whenever this code shipped. An incomplete history is worse than
      // none: it looks authoritative and silently misses the handle a block
      // was placed against.
      const closed = await tx`
        update internal.handle_history
           set released_at = now(), release_reason = 'rotated'
         where app_user_id = ${user.appUserId} and released_at is null
        returning id
      `;
      if (closed.length === 0) {
        await tx`
          insert into internal.handle_history (app_user_id, handle, released_at, release_reason)
          values (${user.appUserId}, ${current.handle}, now(), 'rotated')
        `;
      }
      // Open a tenancy on the new one.
      await tx`
        insert into internal.handle_history (app_user_id, handle)
        values (${user.appUserId}, ${next})
      `;
      await tx`
        update public.app_user
           set handle = ${next}, handle_changed_at = now(), updated_at = now()
         where id = ${user.appUserId}
      `;
      return { handle: next };
    });
  }
}
