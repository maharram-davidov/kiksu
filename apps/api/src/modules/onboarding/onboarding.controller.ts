import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { resolveLocaleFromRequest } from "../../common/locale/locale";
import { z } from "zod";
import { Public } from "../../common/auth/public.decorator";
import { OnboardingService, type UniversityDto } from "./onboarding.service";
import { ConfigService } from "../../config/config.service";

const startBody = z.object({ email: z.string().email().max(254) });
const cardBody = z.object({
  university_id: z.string().uuid(),
  auth_user_id: z.string().uuid(),
  /** Path in the PRIVATE evidence bucket. The image never passes through the API. */
  evidence_path: z.string().min(1).max(512),
  /** Hex SHA-256 of the uploaded bytes, so a later swap is detectable. */
  evidence_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const statusQuery = z.object({ auth_user_id: z.string().uuid() });

const confirmBody = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  /** The Supabase auth subject the caller already holds. */
  auth_user_id: z.string().uuid(),
});

@Controller("onboarding")
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly config: ConfigService,
  ) {}

  /** Submits a student card for manual review. Verifies nobody by itself. */
  @Public()
  @Post("verify/card")
  @HttpCode(202)
  card(@Body() body: unknown): Promise<{ state: string; sla_due_at: string }> {
    const b = cardBody.parse(body);
    return this.onboarding.submitCardVerification(
      b.university_id, b.auth_user_id, b.evidence_path, b.evidence_sha256,
    );
  }

  /** Poll for a decision. Coarse state only; a rejection reason belongs in appeal. */
  @Public()
  @Get("verify/status")
  status(@Query() query: unknown): Promise<{ state: string; method: string | null; sla_due_at: string | null }> {
    return this.onboarding.getVerificationStatus(statusQuery.parse(query).auth_user_id);
  }

  /**
   * DEVELOPMENT ONLY: mints an auth subject so onboarding can be walked end to
   * end without a Supabase project.
   *
   * In production the app signs in anonymously with Supabase Auth first, and
   * the resulting `sub` is what `confirm` binds the pseudonym to. Locally there
   * is no Supabase, so this stands in for that step and nothing else — it
   * grants no tier, creates no app_user, and is refused unless the same
   * development gate that guards the auth bypass is open.
   */
  @Public()
  @Post("dev/session")
  @HttpCode(201)
  async devSession(): Promise<{ auth_user_id: string }> {
    if (!this.config.devAuthAppUserId) {
      // Not merely "off in production": absent the development gate this route
      // does not exist as far as a caller can tell.
      throw new NotFoundException("not_found");
    }
    return this.onboarding.createDevAuthSubject();
  }

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
  start(@Req() req: Request, @Body() body: unknown): Promise<{ expires_in_seconds: number }> {
    // The code email is written in the caller's language. Second real caller of
    // §3.2's negotiation after /reviews/tags — and the one where getting it
    // wrong is most visible, since this message reaches a student before any
    // screen does.
    return this.onboarding.startEmailVerification(
      startBody.parse(body).email,
      resolveLocaleFromRequest(req),
    );
  }

  /**
   * Confirms the code and provisions the pseudonymous account.
   *
   * Requires a signed-in Supabase user: the caller must already hold an auth
   * session so the resulting app_user has something to hang off. It is the
   * verification that is missing at this point, not authentication.
   */
  @Public()
  @Post("verify/email/confirm")
  confirm(@Body() body: unknown): Promise<{ app_user_id: string; handle: string; tier: string }> {
    const { email, code, auth_user_id } = confirmBody.parse(body);
    // The caller presents the auth subject they already hold. It is @Public()
    // because verification is precisely the step BEFORE a caller has a Kiksu
    // identity — requiring a Kiksu token here would be circular. Possession of
    // a valid OTP for a real university address is the credential.
    return this.onboarding.confirmEmailVerification(email, code, auth_user_id);
  }
}
