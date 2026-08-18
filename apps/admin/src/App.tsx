import React from "react";
import { ApiError, adminApi, isAuthConfigured, supabase } from "./api";
import { VerificationQueue } from "./VerificationQueue";
import { ModerationQueue } from "./ModerationQueue";
import { AppealsQueue } from "./AppealsQueue";
import { Login } from "./Login";

type Tab = "verification" | "moderation" | "appeals";

/**
 * The internal console (AD-01 and AD-02).
 *
 * Reachability, not authorisation, is what this component decides. The real
 * check is `StaffGuard` on every admin route, which looks membership up per
 * request from `moderation.staff` rather than trusting a claim — so revoking a
 * moderator takes effect on their next request, not at their next token
 * refresh. Anything this component hides is hidden for tidiness; anything the
 * API refuses is refused for real.
 */
export function App() {
  const [ready, setReady] = React.useState(!isAuthConfigured);
  const [signedIn, setSignedIn] = React.useState(!isAuthConfigured);
  const [email, setEmail] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("verification");
  const [staffError, setStaffError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setEmail(data.session?.user.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // One probe on load, so a non-staff sign-in says so plainly instead of
  // showing two permanently empty queues.
  React.useEffect(() => {
    if (!signedIn) return;
    void adminApi
      .verificationQueue()
      .then(() => setStaffError(null))
      .catch((e: unknown) => {
        // not_found is what StaffGuard returns to a non-staff caller — it does
        // NOT use forbidden, so that an ordinary student cannot confirm this
        // surface exists at a path. Here, where the caller already knows it
        // does, it is safe to translate that into something useful.
        if (e instanceof ApiError && e.status === 404) {
          setStaffError("Bu hesab moderator deyil.");
        } else if (e instanceof ApiError) {
          setStaffError(e.message);
        }
      });
  }, [signedIn]);

  if (!ready) return null;
  if (!signedIn) return <Login />;

  return (
    <div className="shell">
      <header className="top">
        <h1>Kiksu · daxili konsol</h1>
        <span className="who">
          {email ?? "DEV BYPASS"}
          {supabase !== null ? (
            <>
              {" · "}
              <button
                onClick={() => void supabase!.auth.signOut()}
                style={{ background: "none", border: 0, padding: 0, color: "inherit", textDecoration: "underline" }}
              >
                çıxış
              </button>
            </>
          ) : null}
        </span>
      </header>

      {!isAuthConfigured ? (
        <div className="note">
          Supabase konfiqurasiya olunmayıb — API-nin development bypass-ı ilə işləyir.
          Moderator hüquqları üçün <code>./scripts/dev-api.sh --staff</code>.
        </div>
      ) : null}

      {staffError ? <div className="note warn">{staffError}</div> : null}

      <nav className="tabs">
        <button aria-current={tab === "verification"} onClick={() => setTab("verification")}>
          Doğrulama növbəsi
        </button>
        <button aria-current={tab === "moderation"} onClick={() => setTab("moderation")}>
          Moderasiya növbəsi
        </button>
        <button aria-current={tab === "appeals"} onClick={() => setTab("appeals")}>
          Etirazlar
        </button>
      </nav>

      {tab === "verification" ? <VerificationQueue />
        : tab === "moderation" ? <ModerationQueue />
        : <AppealsQueue />}
    </div>
  );
}
