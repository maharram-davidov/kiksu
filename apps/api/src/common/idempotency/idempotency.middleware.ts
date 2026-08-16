import { createHash } from "node:crypto";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error";
import { IdempotencyStore } from "./idempotency.store";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Enforces `Idempotency-Key` on writes, per `05-api-conventions.md` §6.
 *
 * This is genuine Express/Nest middleware (not a guard or interceptor) for one
 * concrete reason: replaying a stored response requires capturing the EXACT status
 * code and body the handler eventually sends, however it gets sent — via Nest's
 * normal return-value serialisation, an explicit `@HttpCode()`, or a raw
 * `@Res() res.json(...)` call. Hooking `res.json` directly (below) is the only place
 * that sees the real, final response regardless of which of those paths a given
 * handler uses; a decorator+interceptor reading route metadata ahead of time would
 * have to duplicate Nest's own status-resolution logic and would silently miss the
 * `@Res()` case.
 *
 * Wire this up per write route in the module that owns it, e.g.:
 * ```ts
 * configure(consumer: MiddlewareConsumer) {
 *   consumer.apply(IdempotencyMiddleware).forRoutes(
 *     { path: "posts", method: RequestMethod.POST },
 *     { path: "posts/:postId/comments", method: RequestMethod.POST },
 *   );
 * }
 * ```
 * Not applied globally — `PUT`/`DELETE` take no key by construction (§6.1) and a
 * plain `POST` query endpoint (none exist yet) shouldn't require one either.
 *
 * §6.3 note for whoever builds the forum endpoints: this middleware is mechanism (1)
 * of the three §6.3 requires ("the idempotency record short-circuits the retry before
 * any allocation runs"). Mechanisms (2) — the alias map's `PRIMARY KEY (post_id,
 * app_user_id)` — and (3) — allocating inside the same transaction as the content
 * insert — are schema/service-layer concerns this middleware cannot provide and does
 * not attempt to.
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger("IdempotencyMiddleware");

  constructor(private readonly store: IdempotencyStore) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const keyHeader = req.headers["idempotency-key"];
      const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;

      // "Missing key on an endpoint that requires one → 422 validation_failed." (§6.2)
      if (!key) {
        throw new AppError("validation_failed", { details: { reason: "idempotency_key_missing" } });
      }
      if (!UUID_V4_PATTERN.test(key)) {
        throw new AppError("validation_failed", { details: { reason: "idempotency_key_invalid" } });
      }

      const appUserId = req.kiksu?.appUserId ?? "unauthenticated";
      const scopeKey = `${appUserId}:${req.method}:${req.path}:${key}`;
      const bodyHash = hashBody(req.body);

      const outcome = await this.store.begin(scopeKey, bodyHash);

      switch (outcome.kind) {
        case "replay": {
          res.setHeader("Idempotency-Replayed", "true");
          res.status(outcome.record.statusCode ?? 200).json(outcome.record.body);
          return; // do NOT call next() — the handler must not run again.
        }
        case "key_reused": {
          // "A replay with the same key and a different body → 422 validation_failed
          // with details.reason: 'idempotency_key_reused'. It is a client bug, and
          // silently serving the first response would hide it." (§6.2)
          throw new AppError("validation_failed", { details: { reason: "idempotency_key_reused" } });
        }
        case "in_flight": {
          res.setHeader("Retry-After", "1");
          throw new AppError("conflict", { details: { reason: "idempotency_in_flight" } });
        }
        case "proceed": {
          this.captureResponse(res, scopeKey);
          next();
          return;
        }
      }
    } catch (err) {
      // Express does not await an async middleware's returned promise, so an
      // exception here must be handed to `next(err)` explicitly or it's silently
      // swallowed. Nest's exception-filter pipeline still catches errors delivered
      // this way — this is the standard pattern for Nest middleware that can fail.
      next(err);
    }
  }

  /**
   * Hooks `res.json` to record the eventual outcome. 5xx responses release the
   * in-flight record instead of caching it — see the doc comment on
   * `IdempotencyStore.release()` for why. Anything else (2xx or 4xx) is cached
   * verbatim so a retry with the same key+body replays deterministically.
   */
  private captureResponse(res: Response, scopeKey: string): void {
    const originalJson = res.json.bind(res);
    let handled = false;

    res.json = ((body: unknown) => {
      handled = true;
      const statusCode = res.statusCode;
      const settle =
        statusCode >= 500
          ? this.store.release(scopeKey)
          : this.store.complete(scopeKey, statusCode, body);
      settle.catch((err: unknown) => this.logger.error("idempotency store write failed", err as Error));
      return originalJson(body);
    }) as Response["json"];

    // Safety net: if the response ends without ever calling res.json (a crash, a
    // raw res.end(), a dropped connection), don't leave the key stuck in_flight
    // forever — release it so a legitimate retry isn't permanently 409'd.
    res.once("finish", () => {
      if (!handled) void this.store.release(scopeKey);
    });
    res.once("close", () => {
      if (!handled) void this.store.release(scopeKey);
    });
  }
}

/** Canonical (key-sorted) JSON hash so `{a:1,b:2}` and `{b:2,a:1}` hash identically. */
function hashBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}
