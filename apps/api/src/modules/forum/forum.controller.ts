import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { ForumService } from "./forum.service";
import type { BoardDto, CommentDto, PostDetailDto, PostPageDto } from "./forum.types";

const createPostBody = z.object({
  board_slug: z.string().min(1).max(80),
  title: z.string().trim().min(3).max(200),
  body: z.string().max(10_000).optional(),
  show_university_badge: z.boolean().optional(),
});

const createCommentBody = z.object({
  body: z.string().trim().min(1).max(5_000),
  parent_id: z.string().uuid().optional(),
});

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

  /** Creates a thread. Alias allocation happens in the same transaction. */
  @Post("posts")
  @HttpCode(201)
  createPost(
    @CurrentUser() user: KiksuRequestContext,
    @Body() body: unknown,
  ): Promise<PostDetailDto> {
    return this.forum.createPost(user, createPostBody.parse(body));
  }

  /** Adds a comment to a thread. */
  @Post("posts/:id/comments")
  @HttpCode(201)
  createComment(
    @CurrentUser() user: KiksuRequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CommentDto> {
    return this.forum.createComment(user, id, createCommentBody.parse(body));
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
