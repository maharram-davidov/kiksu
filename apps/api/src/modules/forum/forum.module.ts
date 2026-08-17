import { Module } from "@nestjs/common";
import { PaginationModule } from "../../common/pagination/pagination.module";
import { ForumController } from "./forum.controller";
import { ForumService } from "./forum.service";
import { ModerationService } from "../moderation/moderation.service";

@Module({
  imports: [PaginationModule],
  controllers: [ForumController],
  providers: [ForumService, ModerationService],
})
export class ForumModule {}
