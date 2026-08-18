import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit/rate-limit.guard";
import { SearchService } from "./search.service";
import type {
  CourseHitDto, InstructorHitDto, ListingHitDto, PostHitDto, SearchPageDto, VacancyHitDto,
} from "./search.types";

/**
 * Two characters, matching `05-openapi.yaml`'s `minLength: 2`. Below that the
 * result set is the whole corpus and the ranking is meaningless, so a shorter
 * query is a validation failure rather than a slow way to return everything.
 * The client simply does not fire until the field holds two characters.
 *
 * There is no upper bound on *meaning* here, only on abuse: `websearch_to_tsquery`
 * handles arbitrary text safely, so the 120-character cap is about payload size.
 */
const q = z.string().trim().min(2).max(120);

/** Page sizes are small: search is a lookup surface, not a feed to scroll. */
const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().max(512).optional();

const postsQuery = z.object({
  q,
  scope: z.enum(["all", "campus", "national"]).default("all"),
  board: z.string().max(80).optional(),
  limit,
  cursor,
});

const plainQuery = z.object({ q, limit, cursor });

const listingsQuery = z.object({
  q,
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).default("relevance"),
  limit,
  cursor,
});

const vacanciesQuery = z.object({
  q,
  sort: z.enum(["relevance", "deadline", "newest"]).default("relevance"),
  limit,
  cursor,
});

/**
 * Global search (HM-03 – HM-06).
 *
 * **Why five endpoints and not one aggregate.** HM-03's "all" state wants a
 * little of everything, and the obvious way to serve it is a single response
 * carrying every corpus. That response would contain post hits (which carry a
 * thread alias, Layer 3) alongside listing hits (which carry the seller's
 * handle, Layer 2 — the marketplace is handle-attributed by product necessity).
 * Identity spec assertion 21 asserts that no client-facing response contains
 * both a thread-alias field and a handle field, and it is checked mechanically
 * over a fixture database.
 *
 * The substantive de-anonymisation risk is absent — different rows, different
 * corpora, nothing correlatable between them — but the assertion exists
 * precisely because mechanical checks catch what reasoning talks itself out of.
 * The client fans out across these endpoints in parallel and merges for
 * display, which costs three requests on the "all" tab and keeps every payload
 * single-layer.
 *
 * **Rate limiting.** All five share the `search.query` bucket (30 / 120 / 120
 * per hour by tier, age-scaled), so a three-way fan-out on the "all" tab spends
 * three of it. That is the honest accounting: it is three queries. If the
 * budget proves tight in practice the fix is a bucket for the fan-out, not a
 * merged response.
 */
@Controller("search")
@UseGuards(RateLimitGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** HM-04. Campus and national results are separated by the `scope` field on each hit. */
  @Get("posts")
  @RateLimit("search.query")
  posts(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<SearchPageDto<PostHitDto>> {
    const p = postsQuery.parse(query);
    return this.search.searchPosts(user, p.q, p.scope, p.board, p.limit, p.cursor);
  }

  /** HM-05, courses half. Rating summary inline so the list is useful without a tap. */
  @Get("courses")
  @RateLimit("search.query")
  courses(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<SearchPageDto<CourseHitDto>> {
    const p = plainQuery.parse(query);
    return this.search.searchCourses(user, p.q, p.limit, p.cursor);
  }

  /** HM-05, professors half. Real public names; no relationship to handle search. */
  @Get("instructors")
  @RateLimit("search.query")
  instructors(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<SearchPageDto<InstructorHitDto>> {
    const p = plainQuery.parse(query);
    return this.search.searchInstructors(user, p.q, p.limit, p.cursor);
  }

  /** HM-06, listings half. */
  @Get("listings")
  @RateLimit("search.query")
  listings(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<SearchPageDto<ListingHitDto>> {
    const p = listingsQuery.parse(query);
    return this.search.searchListings(user, p.q, p.sort, p.limit, p.cursor);
  }

  /** HM-06, jobs half. */
  @Get("vacancies")
  @RateLimit("search.query")
  vacancies(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<SearchPageDto<VacancyHitDto>> {
    const p = vacanciesQuery.parse(query);
    return this.search.searchVacancies(user, p.q, p.sort, p.limit, p.cursor);
  }
}
