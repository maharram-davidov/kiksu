import { Module } from "@nestjs/common";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";
import { ModerationService } from "../moderation/moderation.service";

@Module({ controllers: [ReviewsController], providers: [ReviewsService, ModerationService] })
export class ReviewsModule {}
