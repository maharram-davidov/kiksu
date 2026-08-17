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
 * Auth token holder.
 *
 * DEVELOPMENT SHAPE ONLY. Real sessions come from Supabase Auth once the
 * onboarding screens exist; this exists so the app can be pointed at a running
 * API before that lands. It is deliberately in memory and not persisted, so a
 * token cannot linger on a device.
 */
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function hasAuthToken(): boolean {
  return authToken !== null;
}

export async function apiGet<T>(path: string, locale = "az"): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, {
    headers: {
      Accept: "application/json",
      "Accept-Language": locale,
      "X-Kiksu-Client": "mobile",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });

  if (!res.ok) {
    // The API returns { error: { code, message, action } }. Fall back to the
    // status when a proxy or a crash produces something else, so a screen
    // never renders "undefined".
    let code = `http_${res.status}`;
    let message = `Request failed (${res.status})`;
    let action: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; action?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
      action = body?.error?.action;
    } catch {
      /* keep the status-derived fallback */
    }
    throw new ApiError(code, res.status, message, action);
  }

  return (await res.json()) as T;
}
