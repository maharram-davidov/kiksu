import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The console's link to the API.
 *
 * IT HOLDS NO SERVICE-ROLE KEY. This is a browser app, and the service-role
 * key bypasses RLS and can read the sealed `identity` schema directly — a copy
 * in this bundle would be a copy on every laptop that ever opened the console.
 * Everything privileged happens behind the API's staff routes, which check
 * membership per request. See the SECURITY note in
 * apps/api/src/config/env.schema.ts.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Whether staff sign-in is available in this build.
 *
 * When false the console talks to an API running the development bypass,
 * which answers every request as the seeded student — a moderator only if
 * `dev-api.sh --staff` was used. That is the local path; it is not a way in
 * anywhere real, because `parseEnv()` refuses to boot with the bypass set in
 * production.
 */
export const isAuthConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Staff sign in with email and password, deliberately unlike the
        // anonymous path students take: they are employees, and an account
        // that can read identity documents needs to be recoverable and
        // attributable to a person.
        detectSessionInUrl: false,
      },
    })
  : null;

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Same origin: Vite proxies /v1 to the API in development, and in a real
  // deployment the console sits behind the same host. No CORS to configure,
  // and no preflight on every call.
  const res = await fetch(`/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      // Pinned, not inherited from the browser. The API negotiates locale off
      // this header (§3.2), so without it a moderator on an English-configured
      // laptop gets an Azerbaijani console rendering English error messages.
      // The console's own copy is Azerbaijani; its errors should match.
      "Accept-Language": "az",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(await authHeader()),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep the status-derived fallback */
    }
    throw new ApiError(code, res.status, message);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------------------
// DTOs, mirrored from apps/api/src/modules/admin/admin.service.ts
// ---------------------------------------------------------------------------

export interface QueueCase {
  attempt_id: string;
  university_code: string;
  method: string;
  state: string;
  evidence_path: string | null;
  submitted_at: string;
  sla_due_at: string | null;
  /** Negative once the SLA has been missed. The queue sorts by this. */
  minutes_to_sla: number | null;
}

/**
 * A moderation case.
 *
 * NOTE WHAT IS ABSENT, and that it is absent on purpose: no author, no handle,
 * no karma, no university of the poster, no link to that person's other cases.
 * Identity spec T4 treats the moderation trail as a de-anonymisation index in
 * its own right, and rule (e) is that moderators see none of those things.
 * Author resolution, if it is ever added, must go through a resolver returning
 * a case-scoped label (`Subyekt-7fA2`) and a repeat-offender COUNT — never a
 * durable id and never a case list. Do not add a column here.
 */
export interface ModerationCase {
  case_id: string;
  subject_type: string;
  subject_id: string;
  state: string;
  severity: number | null;
  report_count: number;
  opened_at: string;
  excerpt: string | null;
  reasons: string[];
}

export interface EvidenceUrl {
  url: string;
  expires_in_seconds: number;
}

export const adminApi = {
  verificationQueue: () => api.get<QueueCase[]>("/admin/verification/queue"),
  evidenceUrl: (attemptId: string) =>
    api.get<EvidenceUrl>(`/admin/verification/${attemptId}/evidence`),
  decideVerification: (attemptId: string, approve: boolean, reasonCode?: string) =>
    api.post<{ state: string; handle: string | null }>(
      `/admin/verification/${attemptId}/decide`,
      { approve, ...(reasonCode ? { reason_code: reasonCode } : {}) },
    ),
  moderationQueue: () => api.get<ModerationCase[]>("/admin/moderation/queue"),
  decideModeration: (caseId: string, kind: string, note?: string) =>
    api.post<{ state: string }>(`/admin/moderation/${caseId}/decide`, {
      kind,
      ...(note ? { note } : {}),
    }),
};
