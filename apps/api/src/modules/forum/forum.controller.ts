import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { ForumService } from "./forum.service";
import type { BoardDto, PostDetailDto, PostPageDto } from "./forum.types";

const feedQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller("forum")
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  /** Boards visible to the caller: their campus plus the national tier. */
  @Get("boards")
  boards(@CurrentUser() user: KiksuRequestContext): Promise<BoardDto[]> {
    return this.forum.listBoards(user);
  }

  /** Board feed, keyset-paginated. */
  @Get("boards/:slug/posts")
  feed(
    @CurrentUser() user: KiksuRequestContext,
    @Param("slug") slug: string,
    @Query() query: unknown,
  ): Promise<PostPageDto> {
    const { cursor, limit } = feedQuery.parse(query);
    return this.forum.getBoardFeed(user, slug, cursor ?? null, limit);
  }

  /** Post with its comment thread and the caller's next alias. */
  @Get("posts/:id")
  post(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
  ): Promise<PostDetailDto> {
    return this.forum.getPost(user, id);
  }
}
