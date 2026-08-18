import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { EnrollmentsService } from "./enrollments.service";
import type { CourseSectionDto } from "./enrollments.types";

const query = z.object({ term_id: z.string().uuid().optional() });

/**
 * `GET /v1/catalogue/courses/:id/sections`, at the path the contract has
 * documented since it was written.
 *
 * Mounted separately from `/enrollments` rather than folded into it because
 * this is catalogue data, not the caller's own rows — the only per-caller field
 * on it is `is_enrolled`, which exists so the picker can grey out a section the
 * student already holds instead of letting them tap into an `already_enrolled`
 * error.
 */
@Controller("catalogue")
export class CatalogueController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get("courses/:id/sections")
  sections(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Query() q: unknown,
  ): Promise<CourseSectionDto[]> {
    return this.enrollments.sectionsForCourse(user, id, query.parse(q).term_id);
  }
}
