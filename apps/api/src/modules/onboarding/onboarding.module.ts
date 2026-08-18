import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

// AuthModule for EpochService, RateLimitModule for the OTP send caps. MailModule
// is @Global(), like DbModule and ConfigModule, so it needs no import here.
// AuthModule for EpochService: provisioning a pseudonym is a tier grant, and
// identity spec §7.3 makes that one of the eight events that bump the
// revocation counter. DbModule and ConfigModule are @Global(), AuthModule is
// not, so this import is load-bearing rather than decorative.
@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
