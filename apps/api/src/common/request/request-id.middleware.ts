import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ulid } from "ulid";

/** Augments Express's request type with the field this middleware sets. */
declare module "express-serve-static-core" {
  interface Request {
    /** Set by {@link RequestIdMiddleware}. Always present past that point in the chain. */
    requestId: string;
  }
}

/**
 * Assigns a request id to every inbound request before anything else runs, so it's
 * available to the exception filter no matter where a request fails — including
 * failures inside a guard, before any handler runs.
 *
 * ULID (not UUIDv4) purely for the property the docs' own examples use
 * (`01JAV2H0S8QK5T7ZC9WX3M4B6D`): lexicographically sortable by generation time, which
 * makes log correlation and "find requests around this time" trivial. This is an
 * *internal* identifier for support/log correlation, not a client-facing entity id —
 * the UUIDv4-only rule in `05-api-conventions.md`'s open questions is about ids that
 * appear as durable entity identifiers in response bodies (posts, comments, users),
 * which `request_id` is not; it identifies one HTTP request, not a row.
 *
 * Echoed on every response via `X-Request-Id` (§3.1: "echoed in X-Request-Id"), not
 * only on errors — cheap, and useful for correlating slow-but-successful requests too.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = ulid();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  }
}
