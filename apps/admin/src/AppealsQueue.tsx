import React from "react";
import { ApiError, adminApi, type Appeal } from "./api";

/**
 * AD-03 — open appeals, oldest first.
 *
 * The ordering is the promise: a queue sorted by anything else lets an
 * inconvenient appeal sit forever.
 *
 * Same no-author rule as the moderation queue (identity spec T4(e)). The
 * appeal BODY is here, and that is not a contradiction — those are the
 * student's own words, which they chose to send to staff. Choosing to argue
 * your case is not the same as having your identity handed over, and nothing
 * on this screen says who wrote it.
 *
 * Overturning restores the content server-side, in the same transaction as
 * the decision. An appeal marked overturned that left the post hidden would be
 * worse than no appeal at all.
 */
export function AppealsQueue() {
  const [items, setItems] = React.useState<Appeal[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  const load = React.useCallback(() => {
    adminApi
      .appealQueue()
      .then((a) => { setItems(a); setError(null); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  React.useEffect(load, [load]);

  const decide = async (id: string, outcome: "upheld" | "overturned") => {
    setBusy(id);
    try {
      await adminApi.decideAppeal(id, outcome, notes[id]);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="err">{error}</p>;
  if (!items) return <p className="empty">Yüklənir…</p>;
  if (items.length === 0) return <p className="empty">Etiraz yoxdur.</p>;

  return (
    <>
      <div className="note">
        Müəllif göstərilmir. Etiraz mətni tələbənin öz sözləridir — kimliyi deyil.
        Etiraz qəbul edilsə, məzmun avtomatik bərpa olunur.
      </div>

      {items.map((a) => (
        <div className="card" key={a.appeal_id}>
          <div className="row">
            <span className="pill sev">{a.action_kind.toUpperCase()}</span>
            {a.decided_by_machine ? (
              // Worth flagging: a classifier hit is a rule firing, not a
              // person's judgement, and is far likelier to be wrong in a way
              // the student can explain.
              <span className="pill soon">AVTOMATİK QƏRAR</span>
            ) : (
              <span className="pill ok">İNSAN QƏRARI</span>
            )}
            <span className="meta">
              {a.target_type} · {new Date(a.created_at).toLocaleString("az-AZ")}
            </span>
          </div>

          <p className="excerpt">
            <strong>Məzmun:</strong> {a.excerpt ?? <em>mövcud deyil</em>}
          </p>
          <p className="excerpt">
            <strong>Etiraz:</strong> {a.body}
          </p>

          <input
            className="notefield"
            placeholder="Qərarın səbəbi (tələbəyə göstərilir)"
            value={notes[a.appeal_id] ?? ""}
            onChange={(e) => setNotes((n) => ({ ...n, [a.appeal_id]: e.target.value }))}
          />

          <div className="actions">
            <button
              className="primary"
              disabled={busy === a.appeal_id}
              onClick={() => void decide(a.appeal_id, "overturned")}
            >
              Qəbul et — məzmunu bərpa et
            </button>
            <button
              disabled={busy === a.appeal_id}
              onClick={() => void decide(a.appeal_id, "upheld")}
            >
              Qərar dəyişmir
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
