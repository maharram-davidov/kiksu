import { Module } from "@nestjs/common";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";
import { StaffGuard } from "../admin/staff.guard";

@Module({ controllers: [IngestController], providers: [IngestService, StaffGuard] })
export class IngestModule {}
