import { HttpException } from "@nestjs/common";
import type { ErrorAction, ErrorCode } from "./error-codes";
import { DEFAULT_ACTION_BY_CODE, HTTP_STATUS_BY_CODE } from "./error-codes";

export interface AppErrorOptions {
  /** Overrides the code's default `action` (§3.1) when a call site needs a different affordance. */
  action?: ErrorAction;
  /**
   * Code-specific, documented per code. NEVER a count of people (§3.1 / identity spec
   * assertion 35) — no cohort size, no follower count below 1,000, no "you are one of
   * N" hint. `details.fields` is the one structured shape the contract names, for
   * `validation_failed`.
   */
  details?: Record<string, unknown>;
  /** Present only on `client_version_unsupported` — the store URL for the upgrade wall. */
  storeUrl?: string;
  /**
   * Cause, kept for server-side logs only. Never rendered into `message` — the whole
   * point of this error type is that student-facing text and internal cause are two
   * different strings by construction, not by discipline at each throw site.
   */
  cause?: unknown;
}

/**
 * The one error type every route should throw. Carries a code from the closed set
 * (`error-codes.ts`) and nothing else that could leak into the response by accident —
 * there's no "just interpolate the underlying error's message" path, because there's
 * no field for it. `KiksuExceptionFilter` is the only place `ErrorCode` becomes an
 * HTTP response, so status codes and JSON shape can't drift between call sites.
 *
 * Extends `HttpException` purely so Nest's own machinery (logging interceptors, e2e
 * test helpers that inspect `HttpException`) still recognises it; nothing reads its
 * built-in `.getResponse()` body — the filter reconstructs the envelope from `.code`.
 */
export class AppError extends HttpException {
  public readonly code: ErrorCode;
  public readonly action: ErrorAction;
  public readonly details: Record<string, unknown>;
  public readonly storeUrl: string | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const status = HTTP_STATUS_BY_CODE[code];
    super({ code }, status, { cause: options.cause });
    this.code = code;
    this.action = options.action ?? DEFAULT_ACTION_BY_CODE[code];
    this.details = options.details ?? {};
    this.storeUrl = options.storeUrl;
    this.name = "AppError";
  }
}
