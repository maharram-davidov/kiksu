import React from "react";
import { ApiError, apiGet, apiPost, setAuthToken } from "@/api/client";
import type { MyProfile } from "@/api/types";
import { isSupabaseConfigured, supabase } from "./supabase";

/**
 * Who the app thinks it is.
 *
 * Three states, and the middle one is the reason this exists: a caller can
 * hold an auth subject WITHOUT yet being a verified Kiksu student. Onboarding
 * is precisely the gap between those, so the model has to represent it rather
 * than treating "signed in" as a boolean.
 *
 * Note what is NOT here: the `app_user` id. Nothing on any screen reads it —
 * it was carried purely because onboarding happened to return it — and the
 * server already knows it from the token on every request. Keeping a copy in
 * app state would be one more place a pseudonym identifier lives for no
 * purpose, which is the opposite of how the rest of this product is built.
 */
export type Session =
  | { status: "loading" }
  | { status: "anonymous"; authUserId: string }
  | { status: "verified"; authUserId: string; handle: string; tier: string };

interface SessionContextValue {
  session: Session;
  /** Called once verification succeeds. */
  completeVerification: (v: { handle: string; tier: string }) => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

/** How long to wait before the single retry described in `resolve()`. */
const HYDRATE_RETRY_MS = 1500;

/**
 * Resolves who the caller is, from the API rather than from the token.
 *
 * The handle and the tier are deliberately absent from the access token
 * (identity spec §7.2 — a handle in a token is a rename oracle and lands in
 * every log that captures a bearer header), so there is nothing to decode
 * client-side: `GET /v1/me` is the only way to learn them, and it doubles as
 * the check for whether this auth subject has an `app_user` at all.
 *
 * A 401 is a definitive answer, not a failure. The token hook emits no claims
 * for a caller with no `app_user`, so the guard rejects the token, and that is
 * exactly what "signed in but not yet a student" looks like on the wire.
 *
 * Anything else — a timeout, a refused connection, a 500 — means we genuinely
 * do not know. Guessing "anonymous" there would push an already-verified
 * student into onboarding to re-verify an address they already own, so it is
 * worth one retry first. After that we still have to pick a state, and
 * anonymous is the recoverable one: the screens behind it say so plainly and a
 * relaunch on a working network resolves correctly.
 */
async function resolveStatus(authUserId: string): Promise<Session> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const me = await apiGet<MyProfile>("/me");
      return { status: "verified", authUserId, handle: me.handle, tier: me.verification_tier };
    } catch (err) {
      const definitive = err instanceof ApiError && (err.status === 401 || err.status === 404);
      if (definitive) return { status: "anonymous", authUserId };
      if (attempt === 0) await new Promise((r) => setTimeout(r, HYDRATE_RETRY_MS));
    }
  }
  return { status: "anonymous", authUserId };
}

/**
 * Owns the Supabase session and mirrors its access token into the API client.
 *
 * PERSISTENCE: the session survives a restart, and Supabase Auth owns that —
 * see `supabase.ts`, which keeps it in the Keychain rather than in plaintext
 * storage. This provider holds no durable copy of its own; a second source of
 * truth for who the user is would drift from the first.
 *
 * WITHOUT SUPABASE CONFIGURED the provider falls back to the API's development
 * bypass, which mints a bare auth subject and serves every route as one seeded
 * student. That path is what keeps `scripts/dev-api.sh` usable: it stands up a
 * throwaway Postgres with no GoTrue, so there is nothing to sign in to.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;

    // Registered BEFORE the sign-in below, so a token minted by that call is
    // mirrored into the API client rather than missed in the gap between the
    // call returning and the listener attaching.
    const subscription = supabase?.auth.onAuthStateChange((_event, next) => {
      setAuthToken(next?.access_token ?? null);
      if (!next && !cancelled) setSession({ status: "anonymous", authUserId: "" });
    }).data.subscription;

    (async () => {
      try {
        if (!supabase) {
          // Stands in for a Supabase anonymous sign-in. The route 404s unless
          // the API's development gate is open, so this cannot silently become
          // the production path.
          const { auth_user_id } = await apiPost<{ auth_user_id: string }>(
            "/onboarding/dev/session",
            {},
          );
          const resolved = await resolveStatus(auth_user_id);
          if (!cancelled) setSession(resolved);
          return;
        }

        const existing = await supabase.auth.getSession();
        let authSession = existing.data.session;

        if (!authSession) {
          // Anonymous sign-in rather than a synthetic-email signup: there is no
          // email claim to leak at all, which closes identity spec §7.2's first
          // trap by construction instead of by convention.
          const created = await supabase.auth.signInAnonymously();
          authSession = created.data.session;
        }

        if (!authSession) {
          if (!cancelled) setSession({ status: "anonymous", authUserId: "" });
          return;
        }

        setAuthToken(authSession.access_token);
        const resolved = await resolveStatus(authSession.user.id);
        if (!cancelled) setSession(resolved);
      } catch {
        // No session means onboarding cannot proceed; the screens render the
        // failure rather than the app hanging on a spinner forever.
        if (!cancelled) setSession({ status: "anonymous", authUserId: "" });
      }
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const completeVerification = React.useCallback(
    (v: { handle: string; tier: string }) => {
      setSession((prev) =>
        prev.status === "loading" ? prev : { status: "verified", authUserId: prev.authUserId, ...v },
      );

      // THE TOKEN IN HAND IS STALE, AND SILENTLY SO.
      //
      // It was minted before this student had an `app_user`, so the access-token
      // hook emitted no claims for it and the API rejects it as `token_invalid`.
      // Provisioning does not retroactively change a token that already exists;
      // only a refresh mints one with the new claims in it.
      //
      // Without this line the app would show a verified UI while every
      // authenticated request kept failing — the failure mode is a signed-in
      // student staring at empty screens, with nothing on either side reporting
      // an error, until the token happens to expire.
      //
      // Fire-and-forget because the state above is already correct and the API
      // client retries a 401 by refreshing anyway; this just gets there first.
      void supabase?.auth.refreshSession();
    },
    [],
  );

  const value = React.useMemo(() => ({ session, completeVerification }), [session, completeVerification]);
  return React.createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession() must be used within a <SessionProvider>");
  return ctx;
}

/** Re-exported so screens can explain the bypass without importing two modules. */
export { isSupabaseConfigured };
