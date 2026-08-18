import { Module } from "@nestjs/common";
import { PaginationModule } from "../../common/pagination/pagination.module";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [PaginationModule, RateLimitModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
