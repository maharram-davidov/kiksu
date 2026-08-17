import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { MeService, type MyProfileDto } from "./me.service";

const privacyBody = z.object({
  show_year: z.boolean().optional(),
  share_timetable: z.boolean().optional(),
  show_uni_badge: z.boolean().optional(),
  link_listings: z.boolean().optional(),
  discoverable: z.boolean().optional(),
});

@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The caller's own profile. Exact karma lives here and nowhere else. */
  @Get()
  profile(@CurrentUser() user: KiksuRequestContext): Promise<MyProfileDto> {
    return this.me.getProfile(user);
  }

  @Patch("privacy")
  privacy(
    @CurrentUser() user: KiksuRequestContext,
    @Body() body: unknown,
  ): Promise<MyProfileDto> {
    return this.me.updatePrivacy(user, privacyBody.parse(body));
  }

  /** Rotates to a NEW generated handle. Not user-chosen, by design. */
  @Post("handle/rotate")
  rotateHandle(@CurrentUser() user: KiksuRequestContext): Promise<{ handle: string }> {
    return this.me.rotateHandle(user);
  }
}
