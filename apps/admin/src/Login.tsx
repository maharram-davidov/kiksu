import React from "react";
import { supabase } from "./api";

/**
 * Staff sign-in.
 *
 * Email and password, deliberately unlike the anonymous sign-in students take.
 * A student's whole value proposition is that nobody can attribute their posts
 * to them; a moderator's account is the opposite — it will open student ID
 * documents, and every one of those opens is written to `identity.access_log`
 * with this person's staff id against it. An audit trail pointing at an
 * unattributable account is not an audit trail.
 *
 * There is no sign-up here and there never should be. Staff rows are created
 * out of band; a self-serve route into `moderation.staff` would be a self-serve
 * route into the sealed store.
 */
export function Login() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    // Deliberately undifferentiated: distinguishing "no such account" from
    // "wrong password" turns this form into an oracle for which addresses
    // belong to Kiksu staff, which is a useful list to an attacker.
    if (err) setError("Giriş alınmadı.");
    setBusy(false);
  };

  return (
    <div className="shell">
      <form className="login" onSubmit={submit}>
        <h1>Kiksu · daxili konsol</h1>
        <p>Yalnız işçilər üçün.</p>

        <label htmlFor="email">E-poçt</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="password">Parol</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error ? <p className="err">{error}</p> : null}

        <button type="submit" disabled={busy || !email || !password}>
          {busy ? "Yoxlanılır…" : "Daxil ol"}
        </button>
      </form>
    </div>
  );
}
