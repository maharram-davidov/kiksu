import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../common/auth/public.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { OnboardingService, type UniversityDto } from "./onboarding.service";

const startBody = z.object({ email: z.string().email().max(254) });
const confirmBody = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** The university picker. Public: the caller has no identity yet. */
  @Public()
  @Get("universities")
  universities(): Promise<UniversityDto[]> {
    return this.onboarding.listUniversities();
  }

  /**
   * Sends a one-time code. Public, and deliberately uninformative: the
   * response is the same whether or not the address already has an account,
   * because differentiating would confirm whether a given student is a member.
   */
  @Public()
  @Post("verify/email/start")
  @HttpCode(202)
  start(@Body() body: unknown): Promise<{ expires_in_seconds: number }> {
    return this.onboarding.startEmailVerification(startBody.parse(body).email);
  }

  /**
   * Confirms the code and provisions the pseudonymous account.
   *
   * Requires a signed-in Supabase user: the caller must already hold an auth
   * session so the resulting app_user has something to hang off. It is the
   * verification that is missing at this point, not authentication.
   */
  @Post("verify/email/confirm")
  confirm(
    @CurrentUser() user: KiksuRequestContext,
    @Body() body: unknown,
  ): Promise<{ app_user_id: string; handle: string; tier: string }> {
    const { email, code } = confirmBody.parse(body);
    return this.onboarding.confirmEmailVerification(email, code, user.authUserId);
  }
}
