import { Module } from "@nestjs/common";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { AppealsController } from "./appeals.controller";
import { AppealsService } from "./appeals.service";

/**
 * Appeals.
 *
 * `ModerationService` itself is deliberately NOT provided here — it is
 * constructed inside the modules that classify content on write (forum, chat,
 * reviews), because it has to run in the same transaction as the insert.
 * Appeals are the other half: what happens after a decision, and who may
 * argue with it.
 *
 * `AppealsService` is exported so AdminModule can mount the staff-side queue
 * behind StaffGuard without a second copy of the logic.
 */
@Module({
  imports: [RateLimitModule],
  controllers: [AppealsController],
  providers: [AppealsService],
  exports: [AppealsService],
})
export class ModerationModule {}
