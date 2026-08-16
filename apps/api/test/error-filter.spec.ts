import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/common/errors/app-error";
import { assertCatalogueComplete } from "../src/common/errors/error-catalogue";
import { KiksuExceptionFilter, type ErrorEnvelope } from "../src/common/errors/http-exception.filter";

function makeHost(reqOverrides: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: unknown;

  const res = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      jsonBody = body;
      return res;
    }),
  };

  const req = { headers: {}, requestId: "01JAV2H0S8QK5T7ZC9WX3M4B6D", ...reqOverrides };

  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => jsonBody as ErrorEnvelope,
  };
}

describe("error catalogue completeness", () => {
  it("has an az/ru/en message for every closed error code", () => {
    expect(() => assertCatalogueComplete()).not.toThrow();
  });
});

describe("KiksuExceptionFilter — envelope shape (05-api-conventions.md §3.1)", () => {
  let filter: KiksuExceptionFilter;

  beforeEach(() => {
    filter = new KiksuExceptionFilter();
  });

  it("renders an AppError as the documented envelope with every required field", () => {
    const { host, getStatus, getHeaders, getBody } = makeHost();

    filter.catch(new AppError("tier_insufficient"), host);

    expect(getStatus()).toBe(403);
    const body = getBody();
    expect(body.error.code).toBe("tier_insufficient");
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.message_key).toBe("err.tier_insufficient");
    expect(body.error.action).toBe("verify_card");
    expect(body.error.action_label).toEqual(expect.any(String));
    expect(body.error.details).toEqual({});
    expect(body.error.request_id).toBe("01JAV2H0S8QK5T7ZC9WX3M4B6D");
    expect(body.error.store_url).toBeUndefined();

    const headers = getHeaders();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Content-Language"]).toBe("az"); // default locale
    expect(headers["X-Request-Id"]).toBe("01JAV2H0S8QK5T7ZC9WX3M4B6D");
  });

  it("localises the message via Accept-Language, defaulting to az when absent", () => {
    const { host: hostRu, getBody: getBodyRu } = makeHost({ headers: { "accept-language": "ru" } });
    filter.catch(new AppError("unauthenticated"), hostRu);
    expect(getBodyRu().error.message).toBe("Чтобы продолжить, войдите в аккаунт.");

    const { host: hostDefault, getBody: getBodyDefault } = makeHost();
    filter.catch(new AppError("unauthenticated"), hostDefault);
    // az default message from the catalogue
    expect(getBodyDefault().error.message).toBe("Davam etmək üçün hesabına daxil ol.");
  });

  it("carries details.fields through for validation_failed without altering the envelope shape", () => {
    const { host, getBody } = makeHost();
    filter.catch(
      new AppError("validation_failed", { details: { fields: [{ path: "overall_rating", rule: "range", min: 1, max: 5 }] } }),
      host,
    );
    const body = getBody();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual({ fields: [{ path: "overall_rating", rule: "range", min: 1, max: 5 }] });
  });

  it("adds store_url only for client_version_unsupported", () => {
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new AppError("client_version_unsupported", { storeUrl: "https://apps.apple.com/x" }), host);
    expect(getStatus()).toBe(410);
    expect(getBody().error.store_url).toBe("https://apps.apple.com/x");
  });

  it("maps an unrecognised HttpException by status code, never passing its raw message through", () => {
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new BadRequestException("Unexpected token } in JSON at position 42"), host);
    expect(getStatus()).toBe(400);
    const body = getBody();
    expect(body.error.code).toBe("malformed_request");
    // The framework's raw parser error text must never leak into the response.
    expect(body.error.message).not.toContain("JSON");
    expect(body.error.message).not.toContain("position 42");
  });

  it("collapses any unrecognised exception into a uniform internal_error with no cause-specific detail", () => {
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new Error("relation \"public.app_user\" does not exist, connection to db-primary-7 failed"), host);
    expect(getStatus()).toBe(500);
    const body = getBody();
    expect(body.error.code).toBe("internal_error");
    expect(body.error.details).toEqual({});
    // The SQL error / host name must never reach the response body.
    expect(body.error.message).not.toContain("app_user");
    expect(body.error.message).not.toContain("db-primary-7");
    expect(JSON.stringify(body)).not.toContain("db-primary-7");
  });

  it("produces byte-identical envelopes for a uniform code across different call sites (§3.4)", () => {
    const { host: h1, getBody: b1 } = makeHost();
    const { host: h2, getBody: b2 } = makeHost();

    // Two different underlying causes for invite_code_invalid — wrong code vs. wrong
    // university — must never be distinguishable by response shape.
    filter.catch(new AppError("invite_code_invalid"), h1);
    filter.catch(new AppError("invite_code_invalid"), h2);

    const envelope1 = { ...b1().error, request_id: "x" };
    const envelope2 = { ...b2().error, request_id: "x" };
    expect(envelope1).toEqual(envelope2);
  });
});
