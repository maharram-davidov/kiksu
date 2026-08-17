import { Module } from "@nestjs/common";
import { PaginationModule } from "../../common/pagination/pagination.module";
import { ForumController } from "./forum.controller";
import { ForumService } from "./forum.service";

@Module({
  imports: [PaginationModule],
  controllers: [ForumController],
  providers: [ForumService],
})
export class ForumModule {}
