import type { MinimalRequest } from "../request/request.types";

/**
 * The three supported locales, per `05-api-conventions.md` §3.2. `az` is the product
 * default (`00-project-brief.md`: "Default language Azerbaijani"). This is a closed
 * set for THIS layer — the client-facing `LocaleCode` enum in the OpenAPI contract is
 * likewise closed, unlike the `x-kiksu-enum: open` content enums.
 */
export const SUPPORTED_LOCALES = ["az", "ru", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "az";

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Parses `Accept-Language` down to one of our three supported locales.
 *
 * Deliberately not a full RFC 4647 lookup/filtering implementation — we only ever
 * have three targets, so we take the highest-priority (by q-value, then by position)
 * tag that matches one of `az`/`ru`/`en` by primary subtag, and fall back to `az` on
 * anything else (missing header, unparseable header, or a locale we don't carry).
 * "Unknown or absent → az" is a explicit contract rule (§3.2), not an accident of a
 * generic negotiator.
 */
export function parseAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const candidates = header
    .split(",")
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(";");
      const tag = (tagRaw ?? "").trim().toLowerCase();
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      const primary = tag.split("-")[0] ?? "";
      return { primary, q: Number.isFinite(q) ? q : 1 };
    })
    .filter((c) => c.primary.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    if (isLocale(candidate.primary)) return candidate.primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * Resolves the effective locale for a request per §3.2's precedence:
 * an explicit `Accept-Language` always wins (a student may be showing the screen to
 * someone else); the signed-in caller's `app_user.locale` is only the tie-breaker
 * when the header is absent or unparseable.
 *
 * `callerLocale` is an injection point — nothing in this scaffold reads
 * `app_user.locale` yet (that needs the profile service, out of scope here). Pass it
 * through once that lookup exists; until then this behaves as "Accept-Language, else az".
 */
export function resolveLocale(acceptLanguageHeader: string | undefined | null, callerLocale?: Locale): Locale {
  if (acceptLanguageHeader && acceptLanguageHeader.trim().length > 0) {
    return parseAcceptLanguage(acceptLanguageHeader);
  }
  return callerLocale ?? DEFAULT_LOCALE;
}

/** Convenience overload for pulling straight off an inbound HTTP request. */
export function resolveLocaleFromRequest(req: Pick<MinimalRequest, "headers">, callerLocale?: Locale): Locale {
  const header = req.headers["accept-language"];
  const value = Array.isArray(header) ? header[0] : header;
  return resolveLocale(value, callerLocale);
}
