import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module";
import { ModerationModule } from "../moderation/moderation.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { EvidenceService } from "./evidence.service";
import { StaffGuard } from "./staff.guard";

// AuthModule for EpochService — approving a student card is a tier grant and
// has to revoke the token that still claims the lower tier. AuthModule is not
// @Global(), unlike DbModule and ConfigModule.
@Module({
  imports: [AuthModule, ModerationModule],
  controllers: [AdminController],
  providers: [AdminService, EvidenceService, StaffGuard],
})
export class AdminModule {}
