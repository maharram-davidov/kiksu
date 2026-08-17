import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { StaffGuard } from "./staff.guard";

// AuthModule for EpochService — approving a student card is a tier grant and
// has to revoke the token that still claims the lower tier. AuthModule is not
// @Global(), unlike DbModule and ConfigModule.
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, StaffGuard],
})
export class AdminModule {}
