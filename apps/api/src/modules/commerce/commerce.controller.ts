import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { CommerceService } from "./commerce.service";
import type { ListingDto, VacancyDto } from "./commerce.types";

const listingQuery = z.object({ category: z.string().max(40).optional() });
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
