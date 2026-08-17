import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { TodayService } from "./today.service";
import type { TodayDto } from "./today.types";

@Controller("today")
export class TodayController {
  constructor(private readonly today: TodayService) {}

  /** The landing screen, in one round trip. */
  @Get()
  get(@CurrentUser() user: KiksuRequestContext): Promise<TodayDto> {
    return this.today.getToday(user);
  }
}
