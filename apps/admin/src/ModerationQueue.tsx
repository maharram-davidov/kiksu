import React from "react";
import { ApiError, adminApi, type ModerationCase } from "./api";

/** Decisions about the CONTENT. */
const CONTENT_ACTIONS = [
  { kind: "no_action", label: "Tədbir yoxdur" },
  { kind: "remove_content", label: "Məzmunu sil" },
  { kind: "restore_content", label: "Bərpa et" },
  { kind: "warn", label: "Xəbərdarlıq" },
  { kind: "escalate_legal", label: "Hüquqa ötür" },
] as const;

/**
 * Decisions about the ACCOUNT. These are real now.
 *
 * They used to write an audit row and nothing else — `app_user.status` was
 * read by nothing in the product, so a ban left the student posting freely,
 * and this console said so in a warning box. Both halves exist now: the
 * status is written and every write path checks it.
 *
 * `takesDuration` marks the two that are temporary. Omitting it means the
 * server default — 24h for a mute, 7 days for a suspension.
 */
const ACCOUNT_ACTIONS = [
  { kind: "mute", label: "Səssiz", takesDuration: true },
  { kind: "suspend", label: "Dayandır", takesDuration: true },
  { kind: "ban", label: "Ban", takesDuration: false },
  { kind: "shadowban", label: "Kölgə ban", takesDuration: false },
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
  /** Per-case duration in hours, for the two temporary sanctions. */
  const [hours, setHours] = React.useState<Record<string, string>>({});

  const load = React.useCallback(() => {
    adminApi
      .moderationQueue()
      .then((c) => { setCases(c); setError(null); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  React.useEffect(load, [load]);

  const decide = async (caseId: string, kind: string, durationHours?: number) => {
    setBusy(caseId);
    try {
      await adminApi.decideModeration(caseId, kind, undefined, durationHours);
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
        Hesab tədbirləri müəllifə serverdə tətbiq olunur; kimin olduğu burada
        görünmür.
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
            {CONTENT_ACTIONS.map((a) => (
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

          <div className="actions" style={{ marginTop: 6 }}>
            <input
              className="notefield"
              style={{ width: 130, marginTop: 0 }}
              type="number"
              min={1}
              placeholder="saat (istəyə bağlı)"
              value={hours[c.case_id] ?? ""}
              onChange={(e) => setHours((h) => ({ ...h, [c.case_id]: e.target.value }))}
            />
            {ACCOUNT_ACTIONS.map((a) => (
              <button
                key={a.kind}
                className="danger"
                disabled={busy === c.case_id}
                onClick={() =>
                  void decide(
                    c.case_id, a.kind,
                    a.takesDuration ? Number(hours[c.case_id]) || undefined : undefined,
                  )
                }
              >
                {a.label}
              </button>
            ))}
            <button disabled={busy === c.case_id} onClick={() => void decide(c.case_id, "unban")}>
              Tədbiri götür
            </button>
          </div>

          <div className="note" style={{ marginBottom: 0 }}>
            Səssiz və Dayandır müvəqqətidir — saat yazmasan, 24 saat və 7 gün.
            Ban müddətsizdir. <strong>Kölgə ban</strong> istifadəçini bloklamır:
            yazmağa davam edir və özü görür, amma yeni məzmunu başqalarına
            göstərilmir — bunu bilməməlidir.
          </div>
        </div>
      ))}
    </>
  );
}
