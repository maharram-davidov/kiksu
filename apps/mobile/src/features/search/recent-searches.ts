/**
 * Recent searches, stored on the device and nowhere else.
 *
 * ## Why this is not a server feature
 *
 * A search history keyed to an `app_user_id` is one of the most identifying
 * datasets this product could hold. A student who searches their own faculty,
 * their own dormitory, a course only nine people take, and a health question is
 * de-anonymised by the conjunction long before any single query is revealing —
 * and it would sit in the same database as the pseudonym, joinable by anyone
 * with a query prompt. Identity spec T4's reasoning about the moderation log
 * applies with more force here, because search is high-volume and continuous
 * rather than incident-driven.
 *
 * So there is no `POST /v1/search/history`, no `recent_query` table, and no
 * telemetry event carrying `q`. The list lives in the device keystore, the
 * student can clear it, and clearing it actually deletes the only copy.
 *
 * ## Why the keystore rather than plain storage
 *
 * `expo-secure-store` is what the app already has (there is no AsyncStorage
 * dependency), and it is the right ceiling anyway: a recent-search list is a
 * plaintext record of what a pseudonymous student was curious about, on a
 * phone that gets lent, seized or resold. Ten short strings sit far inside the
 * 2048-byte per-value limit, so no chunking is needed here.
 *
 * ## Trending
 *
 * HM-03 also names trending queries. Deliberately not built: an honest trending
 * list needs query logging, and a campus-scoped one can surface a query only a
 * handful of people made, which is the same small-cohort exposure the
 * k-anonymity floor exists to prevent. If it is wanted later the shape is a
 * counts table with no user column, national-only, floored at a real number of
 * distinct sessions and refreshed in batch — not a live top-N.
 */
import * as SecureStore from "expo-secure-store";

const KEY = "kiksu.search.recent";

/**
 * Ten is a UI decision, but the cap is also a privacy one: an unbounded list
 * turns into a durable interest profile sitting on the device.
 */
export const MAX_RECENT = 10;

/** Long enough to be a real query, short enough that nothing pathological is stored. */
const MAX_ENTRY_LENGTH = 120;

/** The subset of `expo-secure-store` used here, so this is testable without a device. */
export interface RecentStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const defaultStore: RecentStore = SecureStore;

/**
 * Reads the list, tolerating anything.
 *
 * A corrupt or half-written value returns an empty list rather than throwing:
 * this is a convenience feature, and there is no version of "your recent
 * searches could not be parsed" worth showing a student or worth crashing a
 * screen over.
 */
export async function readRecent(store: RecentStore = defaultStore): Promise<string[]> {
  try {
    const raw = await store.getItemAsync(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * Pushes a query to the front, de-duplicating case-insensitively.
 *
 * The de-duplication key folds Azerbaijani the way the server does, so
 * searching `Əliyeva` and then `eliyeva` leaves one entry rather than two that
 * look like different searches. It is a display nicety here rather than a
 * correctness requirement — the server does its own folding — but two entries
 * that a student cannot tell apart is a small, avoidable annoyance.
 */
export async function pushRecent(query: string, store: RecentStore = defaultStore): Promise<string[]> {
  const trimmed = query.trim().slice(0, MAX_ENTRY_LENGTH);
  if (trimmed.length === 0) return readRecent(store);

  const existing = await readRecent(store);
  const key = foldForDedupe(trimmed);
  const next = [trimmed, ...existing.filter((e) => foldForDedupe(e) !== key)].slice(0, MAX_RECENT);

  try {
    await store.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    // A failed write costs the student a convenience, not their query. Never
    // surface it.
  }
  return next;
}

/** Clears the list. The only copy, so this is a real delete. */
export async function clearRecent(store: RecentStore = defaultStore): Promise<void> {
  try {
    await store.deleteItemAsync(KEY);
  } catch {
    // Same reasoning as above.
  }
}

/**
 * The client-side half of `util.fold_text`, for de-duplication only.
 *
 * Mirrors the server's map `ə→e ğ→g ı→i ö→o ş→s ü→u ç→c` and strips the
 * combining dot above, which is what `İ`.toLowerCase() produces on the
 * platforms that produce it. Not a security boundary and not the thing that
 * makes search work — the server folds both the index and the query. If the
 * two ever disagree the only symptom is a duplicated entry in this list.
 */
function foldForDedupe(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/̇/g, "")
    .replace(/[əğıöşüçё]/g, (c) => ({
      "ə": "e", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "ç": "c", "ё": "е",
    }[c] ?? c));
}
