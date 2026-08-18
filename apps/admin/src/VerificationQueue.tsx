import React from "react";
import { ApiError, adminApi, type QueueCase } from "./api";

/** Why a card is rejected. Closed set so a decision is comparable across reviewers. */
const REJECT_REASONS = [
  { code: "unreadable", label: "Oxunmur" },
  { code: "expired", label: "Müddəti bitib" },
  { code: "not_a_card", label: "Tələbə bileti deyil" },
  { code: "mismatch", label: "Universitet uyğun gəlmir" },
  { code: "suspected_reuse", label: "Təkrar istifadə şübhəsi" },
] as const;

/**
 * AD-02 — the student card review queue.
 *
 * This is the screen the build plan says the product is missing: the card
 * route files a case with a 24-hour SLA and, until now, nothing existed that
 * could approve it. The app was making a student a promise nobody could keep.
 *
 * Sorted by `minutes_to_sla`, which the server computes and which goes
 * negative once the deadline is missed — so the breached cases sit at the top
 * without the client doing date arithmetic on a value whose timezone it does
 * not own.
 */
export function VerificationQueue() {
  const [cases, setCases] = React.useState<QueueCase[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    adminApi
      .verificationQueue()
      .then((c) => { setCases(c); setError(null); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  React.useEffect(load, [load]);

  const decide = async (attemptId: string, approve: boolean, reasonCode?: string) => {
    setBusy(attemptId);
    try {
      await adminApi.decideVerification(attemptId, approve, reasonCode);
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
        Tələbə bileti şəkli şəxsiyyət sənədidir. Hər açılış{" "}
        <code>identity.access_log</code>-a yazılır və sənin adına qeyd olunur.
        Link 60 saniyə sonra etibarsız olur.
      </div>

      {cases.map((c) => (
        <CardCase key={c.attempt_id} item={c} busy={busy === c.attempt_id} onDecide={decide} />
      ))}
    </>
  );
}

function CardCase({
  item, busy, onDecide,
}: {
  item: QueueCase;
  busy: boolean;
  onDecide: (id: string, approve: boolean, reason?: string) => void;
}) {
  const [evidence, setEvidence] = React.useState<string | null>(null);
  const [evidenceError, setEvidenceError] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState(false);

  const late = (item.minutes_to_sla ?? 0) < 0;
  const soon = !late && (item.minutes_to_sla ?? Infinity) < 120;

  /**
   * Fetched on demand, never eagerly.
   *
   * Rendering every card in the queue automatically would log an identity
   * access for every case a reviewer scrolled past, which both floods the
   * audit trail and inflates the read-volume figure §7.4 uses as its alarm.
   * A look should mean someone chose to look.
   */
  const reveal = async () => {
    setEvidenceError(null);
    try {
      const { url } = await adminApi.evidenceUrl(item.attempt_id);
      setEvidence(url);
    } catch (e) {
      setEvidenceError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="row">
        <span className="pill sev">{item.university_code}</span>
        <span className={`pill ${late ? "late" : soon ? "soon" : "ok"}`}>
          {late
            ? `SLA ${Math.abs(item.minutes_to_sla!)} DƏQ GECİKİB`
            : item.minutes_to_sla === null
              ? "SLA YOXDUR"
              : `SLA ${item.minutes_to_sla} DƏQ QALIB`}
        </span>
        <span className="meta">
          {item.method} · {new Date(item.submitted_at).toLocaleString("az-AZ")}
        </span>
      </div>

      <div className="evidence">
        {evidence ? (
          // No referrer: the signed URL carries a token in its query string,
          // and a referrer header would hand it to whatever the image links on
          // to. Short-lived is not the same as safe to leak.
          <img src={evidence} alt="Tələbə bileti" referrerPolicy="no-referrer" />
        ) : (
          <button className="inert" onClick={() => void reveal()} disabled={!item.evidence_path}>
            {item.evidence_path ? "Sənədi aç (qeydə alınır)" : "Sənəd silinib"}
          </button>
        )}
        {evidenceError ? <p className="err">{evidenceError}</p> : null}
      </div>

      {rejecting ? (
        <div className="actions">
          {REJECT_REASONS.map((r) => (
            <button
              key={r.code}
              className="danger"
              disabled={busy}
              onClick={() => onDecide(item.attempt_id, false, r.code)}
            >
              {r.label}
            </button>
          ))}
          <button onClick={() => setRejecting(false)} disabled={busy}>Ləğv et</button>
        </div>
      ) : (
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => onDecide(item.attempt_id, true)}>
            Təsdiqlə
          </button>
          <button disabled={busy} onClick={() => setRejecting(true)}>Rədd et</button>
        </div>
      )}
    </div>
  );
}
