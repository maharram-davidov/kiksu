import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ulid } from "ulid";
import { AppError } from "./app-error";
import { ACTION_LABELS } from "./action-labels";
import { getErrorMessage } from "./error-catalogue";
import { DEFAULT_ACTION_BY_CODE, HTTP_STATUS_BY_CODE, type ErrorAction, type ErrorCode } from "./error-codes";
import { resolveLocaleFromRequest, type Locale } from "../locale/locale";

/**
 * The response envelope, exactly per `05-api-conventions.md` §3.1. Every non-2xx
 * response from this API has this shape and `Content-Type: application/json` —
 * enforced here in one place (this is a global filter, see `main.ts`) rather than by
 * convention at every controller.
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode | "internal_error";
    message: string;
    message_key: string;
    action: ErrorAction | null;
    action_label: string | null;
    details: Record<string, unknown>;
    request_id: string;
    /** Present only on `client_version_unsupported` (§1.5). Absent (not null) otherwise. */
    store_url?: string;
  };
}

/**
 * Catches everything — `AppError` (the intended path for every route), any other
 * `HttpException` Nest or a library might throw (validation pipes, body parsers), and
 * truly unexpected errors — and produces the one documented envelope shape for all of
 * them.
 *
 * This is also where the `internal_error` / `service_unavailable` / `dependency_timeout`
 * guarantee lives: "None of them ever carries a detail describing the failing
 * dependency" (§3.3). An unrecognised exception is logged in full server-side (with
 * the request id for correlation) and rendered to the client as a bare `internal_error`
 * with no message, stack, or identifier from the original error — the catalogue string
 * is all that ever leaves the process.
 */
@Catch()
export class KiksuExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("KiksuExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId: string = req.requestId ?? ulid();
    const locale: Locale = resolveLocaleFromRequest(req);

    const { status, code, action, details, storeUrl } = this.normalise(exception, requestId);

    if (status >= 500) {
      // Full detail server-side only. Never in the response — see the class doc.
      this.logger.error(
        `request_id=${requestId} code=${code} status=${status} ${this.describeForLogs(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message: getErrorMessage(code as ErrorCode, locale),
        message_key: `err.${code}`,
        action,
        action_label: action ? ACTION_LABELS[action][locale] : null,
        details,
        request_id: requestId,
        ...(storeUrl ? { store_url: storeUrl } : {}),
      },
    };

    res
      .status(status)
      .setHeader("Content-Type", "application/json")
      .setHeader("Content-Language", locale)
      .setHeader("X-Request-Id", requestId)
      .json(envelope);
  }

  private normalise(
    exception: unknown,
    _requestId: string,
  ): { status: number; code: ErrorCode; action: ErrorAction; details: Record<string, unknown>; storeUrl?: string } {
    if (exception instanceof AppError) {
      return {
        status: HTTP_STATUS_BY_CODE[exception.code],
        code: exception.code,
        action: exception.action,
        details: exception.details,
        storeUrl: exception.storeUrl,
      };
    }

    // A non-AppError HttpException (e.g. Nest's built-in body-parser/validation
    // failures before a handler runs) is mapped onto the closed set by status code,
    // never by passing its message through — that message is framework-authored
    // English and is exactly the "raw" text §3.1 forbids.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = mapHttpStatusToCode(status);
      return { status, code, action: DEFAULT_ACTION_BY_CODE[code], details: {} };
    }

    // Unknown/unexpected — the generic uniform 500. Deliberately no cause-specific
    // code path exists here; that is the guarantee, not an oversight.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "internal_error",
      action: DEFAULT_ACTION_BY_CODE.internal_error,
      details: {},
    };
  }

  /** Server-log-only description. Fine to be verbose here — this never reaches a response. */
  private describeForLogs(exception: unknown): string {
    if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
    try {
      return JSON.stringify(exception);
    } catch {
      return String(exception);
    }
  }
}

/**
 * Fallback mapping for a stock `HttpException` that didn't come through `AppError`
 * (framework-level failures mostly). Deliberately conservative — anything not
 * confidently mappable becomes `malformed_request` (400) or `internal_error` (500),
 * never a guess at a domain-specific code.
 */
function mapHttpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "malformed_request";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 412:
      return "precondition_failed";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 422:
      return "validation_failed";
    case 429:
      return "rate_limited";
    case 503:
      return "service_unavailable";
    case 504:
      return "dependency_timeout";
    default:
      return "internal_error";
  }
}
