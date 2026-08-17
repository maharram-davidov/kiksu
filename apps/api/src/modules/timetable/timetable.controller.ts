import { Controller, Get, NotFoundException, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { TimetableService } from "./timetable.service";
import type { AttendanceDto, CourseSearchItemDto, WeekGridDto } from "./timetable.types";

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
