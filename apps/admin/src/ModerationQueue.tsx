import React from "react";
import { ApiError, adminApi, type ModerationCase } from "./api";

/**
 * The nine decisions the API accepts, split by whether they currently DO
 * anything.
 *
 * `decideModeration` writes a row to `moderation.action` and, for
 * `remove_content`, sets `moderation_state` on the content. It never touches
 * `public.app_user.status` — so mute, suspend, ban and shadowban are recorded
 * and have no effect: the student keeps posting. The API accepts them, so the
 * console offers them, but it says which is which. A ban button that silently
 * does nothing is worse than no ban button, because a moderator walks away
 * believing the case is handled.
 */
const EFFECTIVE = [
  { kind: "no_action", label: "Tədbir yoxdur" },
  { kind: "remove_content", label: "Məzmunu sil" },
  { kind: "restore_content", label: "Bərpa et" },
  { kind: "warn", label: "Xəbərdarlıq" },
  { kind: "escalate_legal", label: "Hüquqa ötür" },
] as const;

const RECORDED_ONLY = [
  { kind: "mute", label: "Səssiz" },
  { kind: "suspend", label: "Dayandır" },
  { kind: "ban", label: "Ban" },
  { kind: "shadowban", label: "Kölgə ban" },
] as const;

/**
 * AD-01 — the moderation queue.
 *
 * WHAT IS NOT ON THIS SCREEN, and must not be added: the author. No handle, no
 * karma, no post count, no university, no link to that person's other cases.
 * Identity spec T4 treats the moderation trail as a de-anonymisation index in
 * its own right — a naive audit row joining alias, app_user and sanction
 * history is "a complete de-anonymisation index for the whole forum, retained
 * indefinitely, and readable by every moderator".
 *
 * Its rule (e) is the one this screen implements: moderators never see those
 * fields. A moderator works from a piece of content and a count of reports.
 * If author resolution is ever needed, T4(b) requires it go through a
 * privileged resolver returning a case-scoped ephemeral label
 * (`HMAC(K_mod, case_id ‖ app_user_id)`, rendered `Subyekt-7fA2`) so the same
 * person in two cases has two unrelated labels, plus a repeat-offender COUNT
 * rather than a case list. That resolver does not exist, and the queue
 * endpoint does not return an author, so this screen is compliant by
 * construction rather than by discipline.
 */
export function ModerationQueue() {
  const [cases, setCases] = React.useState<ModerationCase[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    adminApi
      .moderationQueue()
      .then((c) => { setCases(c); setError(null); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  React.useEffect(load, [load]);

  const decide = async (caseId: string, kind: string) => {
    setBusy(caseId);
    try {
      await adminApi.decideModeration(caseId, kind);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="err">{error}</p>;
  if (!cases) return <p className="empty">Yüklənir…</p>;
  if (cases.length === 0) return <p className="empty">Növbə boşdur.</p>;

  return (
    <>
      <div className="note">
        Müəllif göstərilmir və göstərilməməlidir. Moderator məzmuna və şikayət
        sayına baxır — ləqəb, karma və digər işlər görünmür (identity spec T4).
      </div>

      {cases.map((c) => (
        <div className="card" key={c.case_id}>
          <div className="row">
            <span className="pill sev">SEVERITY {c.severity ?? "—"}</span>
            <span className="pill sev">{c.report_count} ŞİKAYƏT</span>
            <span className="meta">
              {c.subject_type} · {new Date(c.opened_at).toLocaleString("az-AZ")}
            </span>
          </div>

          {c.reasons.length > 0 ? (
            <div className="row" style={{ marginTop: 6 }}>
              {c.reasons.map((r) => (
                <span className="pill soon" key={r}>{r}</span>
              ))}
            </div>
          ) : null}

          <p className="excerpt">{c.excerpt ?? <em>məzmun mövcud deyil</em>}</p>

          <div className="actions">
            {EFFECTIVE.map((a) => (
              <button
                key={a.kind}
                className={a.kind === "remove_content" ? "danger" : ""}
                disabled={busy === c.case_id}
                onClick={() => void decide(c.case_id, a.kind)}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="note warn" style={{ marginBottom: 0 }}>
            Aşağıdakılar yalnız qeydə alınır — hesabın statusu dəyişmir, istifadəçi
            yazmağa davam edir. Sanksiyalar hələ tətbiq olunmur.
            <div className="actions">
              {RECORDED_ONLY.map((a) => (
                <button
                  key={a.kind}
                  className="inert"
                  disabled={busy === c.case_id}
                  onClick={() => void decide(c.case_id, a.kind)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
