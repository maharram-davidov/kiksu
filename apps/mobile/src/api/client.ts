/**
 * Typed fetch wrapper for the Kiksu API.
 *
 * The client holds NO service credentials and never talks to Postgres
 * directly. Every read that touches identity and every write goes through the
 * API, which authorises in code — see docs/01-schema-notes.md. A Supabase
 * anon key does not appear here at all, because the app is not a PostgREST
 * client.
 */
import Constants from "expo-constants";
import { supabase } from "@/session/supabase";

/**
 * Base URL. On a physical phone `localhost` is the PHONE, not your Mac, so
 * development defaults to the host that served the bundle — the same address
 * Expo already printed in the QR — rather than a hardcoded localhost that only
 * ever works in a simulator.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:3000`;

  return "http://localhost:3000";
}

export const API_BASE_URL = resolveBaseUrl();

/** Error carrying the API's closed error code, so screens can branch on it. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly action?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The current access token.
 *
 * Held in memory only, and deliberately: Supabase Auth owns durable session
 * storage (see src/session/supabase.ts, which keeps it in the Keychain), and a
 * second persisted copy here would be a second thing to expire, refresh and
 * invalidate. `SessionProvider` keeps this in step by pushing every token
 * change through `setAuthToken`.
 *
 * Null is a normal state, not an error: under the development bypass the API
 * identifies the caller without a token at all.
 */
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function hasAuthToken(): boolean {
  return authToken !== null;
}

/**
 * One refresh at a time.
 *
 * A screen that fires several queries at once produces several simultaneous
 * 401s the moment a token goes stale. Without this they would each call
 * `refreshSession`, and because refresh tokens rotate with reuse detection, the
 * losers of that race present an already-rotated token — which Supabase treats
 * as a replay and answers by revoking the entire token family. The user is
 * signed out for doing nothing but opening a busy screen.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!supabase) return false; // development bypass: nothing to refresh
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) return false;
      setAuthToken(data.session.access_token);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared inside the same promise so the next 401 after this settles
      // starts a fresh attempt rather than reusing a stale result.
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

interface RequestInitLike {
  method: string;
  path: string;
  body?: unknown;
  locale: string;
}

function buildInit({ method, body, locale }: RequestInitLike): RequestInit {
  return {
    method,
    headers: {
      Accept: "application/json",
      "Accept-Language": locale,
      "X-Kiksu-Client": "mobile",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/**
 * Every request the app makes.
 *
 * This was three near-identical copies of the same fetch-and-unwrap; they are
 * one function now because the retry below has to apply to all of them and
 * three copies of it would have drifted.
 *
 * THE RETRY: the API answers `401 token_stale` when a token's revocation epoch
 * is behind the live one — the normal consequence of a tier being granted or a
 * sanction being applied (identity spec §7.4). The correct response is not to
 * show the user an error: it is to refresh, which mints claims reflecting
 * whatever changed, and try again. Exactly one retry, because a second failure
 * means the session is genuinely gone rather than merely stale, and retrying a
 * dead session in a loop is how a client hammers an auth endpoint.
 */
async function request<T>(init: RequestInitLike): Promise<T> {
  const url = `${API_BASE_URL}/v1${init.path}`;

  let res = await fetch(url, buildInit(init));

  if (res.status === 401 && (await refreshOnce())) {
    // buildInit is called again rather than reused: it reads authToken, which
    // the refresh just replaced.
    res = await fetch(url, buildInit(init));
  }

  if (!res.ok) {
    // The API returns { error: { code, message, action } }. Fall back to the
    // status when a proxy or a crash produces something else, so a screen
    // never renders "undefined".
    let code = `http_${res.status}`;
    let message = `Request failed (${res.status})`;
    let action: string | undefined;
    try {
      const parsed = (await res.json()) as {
        error?: { code?: string; message?: string; action?: string };
      };
      if (parsed?.error?.code) code = parsed.error.code;
      if (parsed?.error?.message) message = parsed.error.message;
      action = parsed?.error?.action;
    } catch {
      /* keep the status-derived fallback */
    }
    throw new ApiError(code, res.status, message, action);
  }

  // 204 and friends have no body; callers of those ignore the return anyway.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string, locale = "az"): Promise<T> {
  return request<T>({ method: "GET", path, locale });
}

export function apiPost<T>(path: string, body: unknown, locale = "az"): Promise<T> {
  return request<T>({ method: "POST", path, body, locale });
}

export function apiPatch<T>(path: string, body: unknown, locale = "az"): Promise<T> {
  return request<T>({ method: "PATCH", path, body, locale });
}

/**
 * DELETE. The API answers 204 with no body for these, which `request` already
 * handles — it reads the body as text and only parses when there is something
 * to parse, so `T` is `void` for every current caller.
 */
export function apiDelete<T>(path: string, locale = "az"): Promise<T> {
  return request<T>({ method: "DELETE", path, locale });
}
