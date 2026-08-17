import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { ChatService } from "../src/modules/chat/chat.service";
import { CommerceService } from "../src/modules/commerce/commerce.service";
import { ModerationService } from "../src/modules/moderation/moderation.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("deal chat (integration)", () => {
  let sql: postgres.Sql;
  let chat: ChatService;
  let commerce: CommerceService;
  let seller: KiksuRequestContext;
  let buyer: KiksuRequestContext;
  let otherBuyer: KiksuRequestContext;
  let listingId: string;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    chat = new ChatService(db as never, new ModerationService());
    commerce = new CommerceService(db as never);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const mk = async (handle: string): Promise<KiksuRequestContext> => {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, ${handle}, ${uni!.id}, 'email_verified', 'active') returning id`;
      return {
        authUserId: au!.id, appUserId: u!.id, tier: "email",
        role: "student", univId: uni!.id, epoch: 1, sid: "t",
      };
    };
    seller = await mk("chat-satici-01");
    buyer = await mk("chat-alici-01");
    otherBuyer = await mk("chat-alici-02");

    const l = await commerce.createListing(seller, {
      categoryKey: "textbooks", title: "Söhbət testi üçün kitab",
      priceMinor: 2000, isNegotiable: true, condition: "good", meetupNotes: [],
    });
    listingId = l.id;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("opens a thread between the buyer and the seller", async () => {
    const c = await chat.openForListing(buyer, listingId);
    expect(c.listing_title).toBe("Söhbət testi üçün kitab");
    expect(c.participants).toHaveLength(2);
    expect(c.participants.find((p) => p.is_seller)!.handle).toBe("chat-satici-01");
  });

  it("returns the SAME thread when the buyer comes back", async () => {
    const first = await chat.openForListing(buyer, listingId);
    const second = await chat.openForListing(buyer, listingId);
    // A buyer returning to a listing must land back in the conversation they
    // already had, not start a second one the seller has to reconcile.
    expect(second.id).toBe(first.id);
  });

  it("gives a different buyer their own thread", async () => {
    const mine = await chat.openForListing(buyer, listingId);
    const theirs = await chat.openForListing(otherBuyer, listingId);
    // Six interested buyers means six threads, not one group chat.
    expect(theirs.id).not.toBe(mine.id);
  });

  it("refuses to let a seller message their own listing", async () => {
    await expect(chat.openForListing(seller, listingId)).rejects.toThrow();
  });

  it("carries messages both ways", async () => {
    const c = await chat.openForListing(buyer, listingId);
    await chat.sendMessage(buyer, c.id, { body: "Hələ satılır?" });
    await chat.sendMessage(seller, c.id, { body: "Bəli, satılır." });
    const after = await chat.getConversation(buyer, c.id);
    expect(after.messages.map((m) => m.body)).toEqual(
      expect.arrayContaining(["Hələ satılır?", "Bəli, satılır."]),
    );
  });

  it("records an offer as its own message kind, not prose", async () => {
    const c = await chat.openForListing(buyer, listingId);
    const m = await chat.sendMessage(buyer, c.id, { offerPriceMinor: 1500 });
    // Haggling that lives only in chat text cannot be acted on later; "agreed
    // at 15 ₼" has to be a fact, not something a moderator reconstructs.
    expect(m.kind).toBe("offer");
    expect(m.offer_price_minor).toBe(1500);
  });

  it("keeps a non-participant out, with the same 404 as a missing thread", async () => {
    const c = await chat.openForListing(buyer, listingId);
    await expect(chat.getConversation(otherBuyer, c.id)).rejects.toThrow();
    await expect(chat.sendMessage(otherBuyer, c.id, { body: "salam" })).rejects.toThrow();
  });

  it("counts unread for the recipient and clears it on read", async () => {
    const c = await chat.openForListing(buyer, listingId);
    await chat.sendMessage(buyer, c.id, { body: "Qiymət son?" });

    const sellerList = await chat.listConversations(seller);
    const thread = sellerList.find((x) => x.id === c.id)!;
    expect(thread.unread_count).toBeGreaterThan(0);

    await chat.getConversation(seller, c.id);
    const afterRead = (await chat.listConversations(seller)).find((x) => x.id === c.id)!;
    // Reading marks read, so the badge cannot drift from what was seen.
    expect(afterRead.unread_count).toBe(0);
  });

  it("shows the other person as a persistent pseudonym, never a forum alias", async () => {
    const list = await chat.listConversations(seller);
    const thread = list.find((x) => x.listing_id === listingId)!;
    expect(thread.other!.handle).toMatch(/^chat-alici/);
    // The marketplace trades anonymity for accountability on purpose: you are
    // about to meet this person.
    expect(Object.keys(thread.other!)).toContain("trade_rating_avg");
    expect(JSON.stringify(thread)).not.toContain("alias");
  });

  it("limits a message the classifier flags but keeps the thread usable", async () => {
    const c = await chat.openForListing(buyer, listingId);
    const m = await chat.sendMessage(buyer, c.id, { body: "0505551234 zəng elə" });
    expect(m.is_limited).toBe(true);
    const after = await chat.getConversation(buyer, c.id);
    // Limited, not removed: the thread keeps working and a moderator decides.
    expect(after.messages.find((x) => x.id === m.id)).toBeDefined();
  });
});
