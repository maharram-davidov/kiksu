import { Module } from "@nestjs/common";
import { CatalogueController } from "./catalogue.controller";
import { EnrollmentsController } from "./enrollments.controller";
import { EnrollmentsService } from "./enrollments.service";
import { TimetableController } from "./timetable.controller";
import { TimetableService } from "./timetable.service";

@Module({
  controllers: [TimetableController, EnrollmentsController, CatalogueController],
  providers: [TimetableService, EnrollmentsService],
})
export class TimetableModule {}
