import React from "react";
import { apiPost, setAuthToken } from "@/api/client";

/**
 * Who the app thinks it is.
 *
 * Three states, and the middle one is the reason this exists: a caller can
 * hold an auth subject WITHOUT yet being a verified Kiksu student. Onboarding
 * is precisely the gap between those, so the model has to represent it rather
 * than treating "signed in" as a boolean.
 */
export type Session =
  | { status: "loading" }
  | { status: "anonymous"; authUserId: string }
  | { status: "verified"; authUserId: string; appUserId: string; handle: string; tier: string };

interface SessionContextValue {
  session: Session;
  /** Called once verification succeeds. */
  completeVerification: (v: { appUserId: string; handle: string; tier: string }) => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

/**
 * NOT PERSISTED, deliberately.
 *
 * Real sessions come from Supabase Auth, which owns token storage and refresh.
 * Persisting a half-built identity here would create a second source of truth
 * for who the user is, and the two would drift. Restarting the app during
 * onboarding starts onboarding again, which is the correct behaviour for an
 * unfinished signup.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Stands in for a Supabase anonymous sign-in. When Supabase Auth is
        // wired this is the ONLY line that changes: everything downstream
        // already treats the subject as opaque.
        const { auth_user_id } = await apiPost<{ auth_user_id: string }>(
          "/onboarding/dev/session",
          {},
        );
        if (!cancelled) setSession({ status: "anonymous", authUserId: auth_user_id });
      } catch {
        // No session means onboarding cannot proceed; the screens render the
        // failure rather than the app hanging on a spinner forever.
        if (!cancelled) setSession({ status: "anonymous", authUserId: "" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const completeVerification = React.useCallback(
    (v: { appUserId: string; handle: string; tier: string }) => {
      setSession((prev) =>
        prev.status === "loading"
          ? prev
          : { status: "verified", authUserId: prev.authUserId, ...v },
      );
      // The API currently identifies the caller by the development bypass, so
      // there is no bearer token to set yet. Kept explicit so that wiring
      // Supabase means setting a real token here, not restructuring this.
      setAuthToken(null);
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
