import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { StaffGuard } from "./staff.guard";

@Module({ controllers: [AdminController], providers: [AdminService, StaffGuard] })
export class AdminModule {}
