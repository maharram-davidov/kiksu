import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { EnrollmentsService } from "./enrollments.service";
import { ACCENT_COLORS, ENROLLMENT_STATES } from "./enrollments.types";
import type { EnrollmentDto } from "./enrollments.types";

const listQuery = z.object({
  term_id: z.string().uuid().optional(),
  state: z.enum([...ENROLLMENT_STATES, "all"]).default("enrolled"),
});

const createBody = z.object({
  section_id: z.string().uuid(),
  color: z.enum(ACCENT_COLORS).optional(),
});

const updateBody = z
  .object({
    color: z.enum(ACCENT_COLORS).optional(),
    display_order: z.coerce.number().int().min(0).max(999).optional(),
    state: z.enum(ENROLLMENT_STATES).optional(),
  })
  // An empty PATCH is a client bug, not a no-op worth absorbing silently.
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "at least one field is required",
  });

/**
 * The caller's own timetable, at the path `05-openapi.yaml` already documents.
 *
 * Mounted at `/enrollments` rather than under `/timetable/*` deliberately: the
 * contract has specified these four operations at this path since it was
 * written, and they were simply never implemented. Two of the API's paths have
 * already drifted from the document that is supposed to define them; adding a
 * third invented path when a documented one exists would make the OpenAPI file
 * a description of nothing.
 */
@Controller("enrollments")
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  list(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<EnrollmentDto[]> {
    const q = listQuery.parse(query);
    return this.enrollments.list(user, q.term_id, q.state);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: KiksuRequestContext,
    @Body() body: unknown,
  ): Promise<EnrollmentDto> {
    return this.enrollments.create(user, createBody.parse(body));
  }

  @Patch(":id")
  update(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<EnrollmentDto> {
    return this.enrollments.update(user, id, updateBody.parse(body));
  }

  /** Soft drop — see `EnrollmentsService`'s class comment for why it is not a delete. */
  @Delete(":id")
  @HttpCode(204)
  async drop(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<void> {
    await this.enrollments.drop(user, id);
  }
}
