import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { KiksuRequestContext } from "./request-context";

/**
 * Injects the caller's trusted claims into a controller method:
 * `findMine(@CurrentUser() user: KiksuRequestContext)`.
 *
 * This is the ONLY way a handler should learn who the caller is. Per §2.3: "No
 * endpoint accepts `app_user_id`, `user_id`, `author_id`, `subject_id`, `handle` or a
 * thread alias as an input identifying the caller. The caller is always the token."
 * There is deliberately no equivalent decorator or helper for pulling an identity out
 * of a request body or a query parameter.
 *
 * Throws (via a non-null assertion) if used on a route that isn't behind `AuthGuard` —
 * i.e. a `@Public()` route. That's intentional: reaching for `@CurrentUser()` on a
 * public route is a handler bug, and failing loudly beats silently injecting
 * `undefined` into code that assumes a caller exists.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): KiksuRequestContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.kiksu) {
    throw new Error(
      "@CurrentUser() used on a route with no authenticated request context. " +
        "Is this route accidentally marked @Public(), or missing AuthGuard?",
    );
  }
  return req.kiksu;
});
