import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { ChatService } from "./chat.service";
import type { ChatMessageDto, ConversationDto, ConversationSummaryDto } from "./chat.types";

const sendBody = z
  .object({
    body: z.string().trim().max(2000).optional(),
    /** Minor units, like every price. Present makes this an `offer` message. */
    offer_price_minor: z.coerce.number().int().min(0).max(100_000_00).optional(),
  })
  .refine((v) => Boolean(v.body) || v.offer_price_minor !== undefined, {
    message: "body_or_offer_required",
  });

@Controller("market")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Opens the thread for a listing, or returns the existing one. */
  @Post("listings/:id/conversation")
  @HttpCode(200)
  open(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<ConversationDto> {
    return this.chat.openForListing(user, id);
  }

  @Get("conversations")
  list(@CurrentUser() user: KiksuRequestContext): Promise<ConversationSummaryDto[]> {
    return this.chat.listConversations(user);
  }

  /** Reading marks read, so the unread badge cannot drift from what was seen. */
  @Get("conversations/:id")
  conversation(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<ConversationDto> {
    return this.chat.getConversation(user, id);
  }

  @Post("conversations/:id/messages")
  @HttpCode(201)
  send(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ChatMessageDto> {
    const b = sendBody.parse(body);
    return this.chat.sendMessage(user, id, {
      body: b.body,
      offerPriceMinor: b.offer_price_minor,
    });
  }
}
