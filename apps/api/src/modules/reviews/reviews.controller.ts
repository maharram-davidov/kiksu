import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { resolveLocaleFromRequest } from "../../common/locale/locale";
import { ReviewsService } from "./reviews.service";
import type {
  InstructorProfileDto, ReviewableDto, ReviewPageDto, ReviewTagDto,
} from "./reviews.types";

const rating = z.coerce.number().int().min(1).max(5);

const createBody = z.object({
  course_id: z.string().uuid(),
  instructor_id: z.string().uuid(),
  overall_rating: rating,
  quality: rating,
  fairness: rating,
  workload: rating,
  attendance_strictness: rating,
  tags: z.array(z.string().max(40)).max(6).default([]),
  /** Optional by design: the structured ratings are what the product defends. */
  body: z.string().trim().max(2000).optional(),
});

const listQuery = z.object({ course_id: z.string().uuid().optional() });

@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /**
   * The tag vocabulary, for the composer's chips.
   *
   * Declared BEFORE `instructors/:id` deliberately — these are static segments
   * under the same controller, and Nest matches in declaration order, so a
   * later `tags` would be swallowed by an earlier `:id` pattern if the paths
   * ever converge.
   */
  @Get("tags")
  tags(@Req() req: Request): Promise<ReviewTagDto[]> {
    // Reference-data labels are the exact case §3.2's locale negotiation was
    // written for; this is its first real caller.
    return this.reviews.listTags(resolveLocaleFromRequest(req));
  }

  /** Course x instructor pairs the caller may review this term. */
  @Get("reviewable")
  reviewable(@CurrentUser() user: KiksuRequestContext): Promise<ReviewableDto[]> {
    return this.reviews.listReviewable(user);
  }

  /** Aggregates are ungated: they are what makes the contribution wall worth climbing. */
  @Get("instructors/:id")
  instructor(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<InstructorProfileDto> {
    return this.reviews.getInstructor(user, id);
  }

  /**
   * Written reviews. Returns 200 with an empty list and the wall's state when
   * the caller has not contributed — never a 403, so the client can render a
   * prompt rather than an error.
   */
  @Get("instructors/:id/reviews")
  list(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<ReviewPageDto> {
    return this.reviews.listReviews(user, id, listQuery.parse(query).course_id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: KiksuRequestContext, @Body() body: unknown) {
    const b = createBody.parse(body);
    return this.reviews.createReview(user, {
      courseId: b.course_id,
      instructorId: b.instructor_id,
      overall: b.overall_rating,
      quality: b.quality,
      fairness: b.fairness,
      workload: b.workload,
      attendanceStrictness: b.attendance_strictness,
      tags: b.tags,
      body: b.body,
    });
  }
}
