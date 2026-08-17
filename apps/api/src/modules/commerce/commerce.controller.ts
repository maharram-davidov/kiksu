import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { CommerceService } from "./commerce.service";
import type { CategoryDto, ListingDto, VacancyDto } from "./commerce.types";

const listingQuery = z.object({ category: z.string().max(40).optional() });

const createListingBody = z.object({
  category_key: z.string().min(1).max(40),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(4000).optional(),
  /** Minor units (qəpik). Never a float: 25 manat is 2500. */
  price_minor: z.coerce.number().int().min(0).max(100_000_00),
  is_negotiable: z.boolean().default(false),
  condition: z.enum(["new", "like_new", "good", "fair", "poor"]),
  meetup_notes: z.array(z.string().trim().max(300)).max(3).default([]),
  related_course_id: z.string().uuid().optional(),
});
const vacancyQuery = z.object({ kind: z.string().max(40).optional() });

@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get("market/listings")
  listings(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<ListingDto[]> {
    return this.commerce.listListings(user, listingQuery.parse(query).category);
  }

  @Get("market/categories")
  categories(): Promise<CategoryDto[]> {
    return this.commerce.listCategories();
  }

  @Post("market/listings")
  @HttpCode(201)
  createListing(
    @CurrentUser() user: KiksuRequestContext,
    @Body() body: unknown,
  ): Promise<ListingDto> {
    const b = createListingBody.parse(body);
    return this.commerce.createListing(user, {
      categoryKey: b.category_key,
      title: b.title,
      description: b.description,
      priceMinor: b.price_minor,
      isNegotiable: b.is_negotiable,
      condition: b.condition,
      meetupNotes: b.meetup_notes,
      relatedCourseId: b.related_course_id,
    });
  }

  @Get("market/listings/:id")
  listing(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<ListingDto> {
    return this.commerce.getListing(user, id);
  }

  @Get("careers/vacancies")
  vacancies(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<VacancyDto[]> {
    return this.commerce.listVacancies(user, vacancyQuery.parse(query).kind);
  }
}
