import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { TimetableService } from "./timetable.service";
import type { AttendanceDto, ClassDetailDto, CourseSearchItemDto, WeekGridDto } from "./timetable.types";

const absenceBody = z.object({
  /** ISO date. Defaults to today in the caller's own reckoning if omitted. */
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const searchQuery = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller("timetable")
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  /** The week grid for the caller's current term. */
  @Get("week")
  async week(@CurrentUser() user: KiksuRequestContext): Promise<WeekGridDto> {
    const grid = await this.timetable.getWeekGrid(user);
    if (!grid) {
      // No current term configured for this campus. This is an operations
      // state, not a user error: it means the catalogue for the semester has
      // not been loaded yet.
      throw new NotFoundException("no_current_term");
    }
    return grid;
  }

  /** Per-course absence counts against the university's configured limit. */
  @Get("attendance")
  attendance(@CurrentUser() user: KiksuRequestContext): Promise<AttendanceDto[]> {
    return this.timetable.getAttendance(user);
  }

  /** Everything the class detail sheet shows, in one call. */
  @Get("sections/:id")
  section(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<ClassDetailDto> {
    return this.timetable.getClassDetail(user, id);
  }

  /**
   * Records a self-reported absence. Idempotent per date: tapping twice must
   * not cost a student a second absence against a limit that can exclude them.
   */
  @Post("sections/:id/absence")
  @HttpCode(200)
  absence(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ absences: number; max_absences: number }> {
    return this.timetable.recordAbsence(user, id, absenceBody.parse(body).occurred_on);
  }

  /** Course catalogue search, scoped to the caller's campus. */
  @Get("courses")
  courses(
    @CurrentUser() user: KiksuRequestContext,
    @Query() query: unknown,
  ): Promise<CourseSearchItemDto[]> {
    const { q, limit } = searchQuery.parse(query);
    return this.timetable.searchCourses(user, q, limit);
  }
}
