/**
 * Deal chat shapes.
 *
 * A chat participant is the marketplace's persistent pseudonym — a handle and
 * a rating — NOT a forum alias. That is the same trade the seller card makes:
 * you are about to arrange to meet this person, so you need to know it is the
 * same person you were talking to yesterday. It stays unlinkable to their
 * forum and review activity.
 */
export interface ChatParticipantDto {
  app_user_id: string;
  handle: string;
  avatar_id: number;
  verification_status: "card" | "email" | "none";
  trade_rating_avg: number | null;
  /** True for the person who owns the listing this thread is about. */
  is_seller: boolean;
}

export interface ChatMessageDto {
  id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  /** Set on an `offer` message. Minor units, like every price in the system. */
  offer_price_minor: number | null;
  created_at: string;
  /** True when the classifier limited it; the client renders a placeholder. */
  is_limited: boolean;
}

export interface ConversationSummaryDto {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  listing_price_minor: number | null;
  other: ChatParticipantDto | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_closed: boolean;
}

export interface ConversationDto {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  listing_price_minor: number | null;
  participants: ChatParticipantDto[];
  messages: ChatMessageDto[];
  is_closed: boolean;
}
