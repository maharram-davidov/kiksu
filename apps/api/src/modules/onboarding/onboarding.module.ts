import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

// AuthModule for EpochService: provisioning a pseudonym is a tier grant, and
// identity spec §7.3 makes that one of the eight events that bump the
// revocation counter. DbModule and ConfigModule are @Global(), AuthModule is
// not, so this import is load-bearing rather than decorative.
@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
