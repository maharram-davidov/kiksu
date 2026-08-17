import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { ModerationService } from "../moderation/moderation.service";
import type {
  ChatMessageDto, ChatParticipantDto, ConversationDto, ConversationSummaryDto,
} from "./chat.types";

function tierBadge(t: string | null): "card" | "email" | "none" {
  return t === "card_verified" ? "card" : t === "email_verified" ? "email" : "none";
}

/**
 * Deal chat: one thread per (listing, buyer).
 *
 * That shape matters. A seller with six interested buyers needs six separate
 * threads, not one; and a buyer returning to a listing they enquired about
 * last week must land back in the same conversation rather than starting a
 * second one the seller then has to reconcile.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: SqlProvider,
    private readonly moderation: ModerationService,
  ) {}

  /**
   * Opens the thread for a listing, or returns the existing one.
   *
   * Idempotent by construction: the buyer's identity plus the listing is the
   * key. A seller cannot start a thread with themselves, which would otherwise
   * be an easy way to make a listing look busy.
   */
  async openForListing(user: KiksuRequestContext, listingId: string): Promise<ConversationDto> {
    const conversationId = await this.db.transaction(async (tx) => {
      const [listing] = await tx<Array<{ id: string; seller_id: string }>>`
        select id, seller_id from public.listing
         where id = ${listingId}
           and university_id = ${user.univId}
           and status in ('active', 'reserved')
           and deleted_at is null
      `;
      if (!listing) throw new NotFoundException("listing_not_found");
      if (listing.seller_id === user.appUserId) {
        throw new BadRequestException("cannot_message_own_listing");
      }

      const [existing] = await tx<Array<{ id: string }>>`
        select c.id from public.conversation c
          join public.conversation_participant p
            on p.conversation_id = c.id and p.app_user_id = ${user.appUserId}
         where c.listing_id = ${listingId} and c.kind = 'listing'
         limit 1
      `;
      if (existing) return existing.id;

      const [created] = await tx<Array<{ id: string }>>`
        insert into public.conversation (kind, listing_id, created_by)
        values ('listing', ${listingId}, ${user.appUserId})
        returning id
      `;
      if (!created) throw new BadRequestException("conversation_failed");

      await tx`
        insert into public.conversation_participant (conversation_id, app_user_id, role)
        values (${created.id}, ${user.appUserId}, 'member'),
               (${created.id}, ${listing.seller_id}, 'member')
        on conflict do nothing
      `;
      return created.id;
    });

    return this.getConversation(user, conversationId);
  }

  async listConversations(user: KiksuRequestContext): Promise<ConversationSummaryDto[]> {
    const rows = await this.db.sql<Array<Record<string, unknown>>>`
      select c.id, c.listing_id, c.last_message_at, c.is_closed,
             l.title as listing_title, l.price_minor as listing_price_minor,
             me.unread_count,
             o.app_user_id as other_id, o.handle as other_handle,
             o.avatar_id as other_avatar, o.verification_tier::text as other_tier,
             o.trade_rating_avg as other_rating,
             (o.app_user_id = l.seller_id) as other_is_seller,
             (select left(m.body, 80) from public.chat_message m
               where m.conversation_id = c.id and m.deleted_at is null
                 and m.moderation_state in ('visible','limited')
               order by m.created_at desc limit 1) as preview
        from public.conversation c
        join public.conversation_participant me
          on me.conversation_id = c.id and me.app_user_id = ${user.appUserId}
             and me.left_at is null
        left join public.listing l on l.id = c.listing_id
        left join lateral (
          select p.app_user_id, au.handle, au.avatar_id, au.verification_tier, au.trade_rating_avg
            from public.conversation_participant p
            join public.app_user au on au.id = p.app_user_id
           where p.conversation_id = c.id and p.app_user_id <> ${user.appUserId}
           limit 1
        ) o on true
       order by c.last_message_at desc nulls last, c.created_at desc
       limit 50
    `;

    return rows.map((r) => ({
      id: r.id as string,
      listing_id: (r.listing_id as string) ?? null,
      listing_title: (r.listing_title as string) ?? null,
      listing_price_minor: r.listing_price_minor === null ? null : Number(r.listing_price_minor),
      other: r.other_id
        ? {
            app_user_id: r.other_id as string,
            handle: r.other_handle as string,
            avatar_id: Number(r.other_avatar ?? 0),
            verification_status: tierBadge(r.other_tier as string),
            trade_rating_avg: r.other_rating === null ? null : Number(r.other_rating),
            is_seller: Boolean(r.other_is_seller),
          }
        : null,
      last_message_at: r.last_message_at ? (r.last_message_at as Date).toISOString() : null,
      last_message_preview: (r.preview as string) ?? null,
      unread_count: Number(r.unread_count ?? 0),
      is_closed: Boolean(r.is_closed),
    }));
  }

  async getConversation(user: KiksuRequestContext, conversationId: string): Promise<ConversationDto> {
    const { sql } = this.db;

    const [head] = await sql<Array<Record<string, unknown>>>`
      select c.id, c.listing_id, c.is_closed, l.title as listing_title,
             l.price_minor as listing_price_minor, l.seller_id
        from public.conversation c
        join public.conversation_participant p
          on p.conversation_id = c.id and p.app_user_id = ${user.appUserId} and p.left_at is null
        left join public.listing l on l.id = c.listing_id
       where c.id = ${conversationId}
    `;
    // Same 404 whether the thread is missing or the caller is not in it: a
    // distinguishable error would confirm that a given conversation exists.
    if (!head) throw new NotFoundException("conversation_not_found");

    const sellerId = (head.seller_id as string | null) ?? null;
    const participants = await sql<Array<Record<string, unknown>>>`
      select au.id as app_user_id, au.handle, au.avatar_id,
             au.verification_tier::text as tier, au.trade_rating_avg,
             (au.id = ${sellerId}::uuid) as is_seller
        from public.conversation_participant p
        join public.app_user au on au.id = p.app_user_id
       where p.conversation_id = ${conversationId}
    `;

    const messages = await sql<Array<Record<string, unknown>>>`
      select m.id, m.sender_id, m.kind::text as kind, m.body, m.offer_price_minor,
             m.created_at, m.moderation_state::text as moderation_state
        from public.chat_message m
       where m.conversation_id = ${conversationId}
         and m.deleted_at is null
         and m.moderation_state <> 'removed'
       order by m.created_at
       limit 200
    `;

    // Reading marks read. Doing it here rather than in a separate call means
    // the unread badge cannot drift from what the person has actually seen.
    await sql`
      update public.conversation_participant
         set last_read_at = now(), unread_count = 0
       where conversation_id = ${conversationId} and app_user_id = ${user.appUserId}
    `;

    return {
      id: head.id as string,
      listing_id: (head.listing_id as string) ?? null,
      listing_title: (head.listing_title as string) ?? null,
      listing_price_minor: head.listing_price_minor === null ? null : Number(head.listing_price_minor),
      participants: participants.map<ChatParticipantDto>((p: Record<string, unknown>) => ({
        app_user_id: p.app_user_id as string,
        handle: p.handle as string,
        avatar_id: Number(p.avatar_id ?? 0),
        verification_status: tierBadge(p.tier as string),
        trade_rating_avg: p.trade_rating_avg === null ? null : Number(p.trade_rating_avg),
        is_seller: Boolean(p.is_seller),
      })),
      messages: messages.map<ChatMessageDto>((m) => ({
        id: m.id as string,
        sender_id: m.sender_id as string,
        kind: m.kind as string,
        body: (m.body as string) ?? null,
        offer_price_minor: m.offer_price_minor === null ? null : Number(m.offer_price_minor),
        created_at: (m.created_at as Date).toISOString(),
        is_limited: m.moderation_state === "limited",
      })),
      is_closed: Boolean(head.is_closed),
    };
  }

  /**
   * Sends a message, or a structured offer.
   *
   * An offer is its own message kind rather than a number typed into prose,
   * because haggling that lives only in chat text cannot be acted on later —
   * the plan wants "agreed at 20 ₼" to be a fact the deal record can carry,
   * not something a moderator has to read a thread to reconstruct.
   */
  async sendMessage(
    user: KiksuRequestContext,
    conversationId: string,
    input: { body?: string; offerPriceMinor?: number },
  ): Promise<ChatMessageDto> {
    return this.db.transaction(async (tx) => {
      const [participant] = await tx<Array<{ id: string }>>`
        select c.id from public.conversation c
          join public.conversation_participant p
            on p.conversation_id = c.id and p.app_user_id = ${user.appUserId} and p.left_at is null
         where c.id = ${conversationId} and c.is_closed = false
         for update of c
      `;
      if (!participant) throw new NotFoundException("conversation_not_found");

      const isOffer = input.offerPriceMinor !== undefined;
      if (!isOffer && !input.body?.trim()) throw new BadRequestException("empty_message");

      const [row] = await tx<Array<Record<string, unknown>>>`
        insert into public.chat_message (conversation_id, sender_id, kind, body, offer_price_minor)
        values (${conversationId}, ${user.appUserId},
                ${isOffer ? "offer" : "text"}::public.chat_message_kind,
                ${input.body?.trim() ?? null}, ${input.offerPriceMinor ?? null})
        returning id, sender_id, kind::text as kind, body, offer_price_minor,
                  created_at, moderation_state::text as moderation_state
      `;
      if (!row) throw new BadRequestException("message_failed");

      // Chat is private between two people, so a phone number here is not the
      // broadcast risk it is on a board. It is still classified, because the
      // other common case — a scam script pasted into every thread — looks
      // exactly the same to the rules and is worth a moderator seeing.
      const hits = await this.moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: row.id as string,
        universityId: user.univId, body: input.body ?? null,
      });
      const limited = hits !== "visible";
      if (limited) {
        await tx`update public.chat_message set moderation_state = 'limited'
                  where id = ${row.id as string}`;
      }

      await tx`
        update public.conversation
           set last_message_at = now(), message_count = message_count + 1
         where id = ${conversationId}
      `;
      await tx`
        update public.conversation_participant
           set unread_count = unread_count + 1
         where conversation_id = ${conversationId} and app_user_id <> ${user.appUserId}
      `;

      return {
        id: row.id as string,
        sender_id: row.sender_id as string,
        kind: row.kind as string,
        body: (row.body as string) ?? null,
        offer_price_minor: row.offer_price_minor === null ? null : Number(row.offer_price_minor),
        created_at: (row.created_at as Date).toISOString(),
        is_limited: limited,
      };
    });
  }
}
