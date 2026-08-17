/**
 * Tier 1 of the moderation pipeline: fast, local, deterministic rules.
 *
 * WHY RULES AT ALL, given the plan calls for an LLM classifier: some harms are
 * unambiguous and arrive fast, and paying a model round-trip to notice a phone
 * number is both slower and less reliable than a regex. The LLM tier exists for
 * the judgement calls this layer deliberately does not attempt — tone, context,
 * whether criticism of a lecturer has tipped into abuse.
 *
 * WHAT THIS LAYER MUST NOT DO is guess. Every rule here fires only on something
 * structurally identifiable. A rule that tries to detect "rudeness" by keyword
 * in Azerbaijani would produce constant false positives, and a moderation
 * system that cries wolf gets ignored by the humans it is meant to help.
 */

export type RuleSeverity = 1 | 2 | 3 | 4 | 5;

export interface RuleHit {
  rule: string;
  reasonKey: string;
  severity: RuleSeverity;
  /** Human-readable, for the moderator's queue row. Never the matched text. */
  note: string;
}

/**
 * Azerbaijani mobile numbers. Operator codes are 010/012/050/051/055/060/070/
 * 077/099, written with or without +994, and with any mix of spaces, dots and
 * dashes between groups.
 *
 * Posting one is the single most common way a student de-anonymises themselves
 * on a board like this, usually without meaning to — which is why it is
 * severity 5 and hides at a low threshold rather than waiting for reports.
 */
const AZ_PHONE = /(?:\+?994[\s.-]*)?\(?0?(?:10|12|50|51|55|60|70|77|99)\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}\b/;

/** Any email address. Same reasoning as a phone number. */
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Messaging handles, the other common self-doxx: @user, t.me/x, wa.me/x. */
const CONTACT_HANDLE = /(?:t\.me\/|wa\.me\/|telegram\.me\/|instagram\.com\/)[a-z0-9_.]+/i;

/** Four or more links in one body is advertising, not conversation. */
const LINK = /https?:\/\/\S+/gi;

/** The same character fifteen times or more: keyboard mashing or shouting. */
const CHAR_FLOOD = /(.)\1{14,}/;

/**
 * Azerbaijani student ID patterns seen on cards. Not exhaustive and not meant
 * to be — it catches the obvious paste, not every possible format.
 */
const STUDENT_ID = /\b(?:tələbə|telebe|student)\s*(?:no|№|nömrə|nomre)?[:\s.]*\d{6,}\b/i;

export function runRules(text: string | null | undefined): RuleHit[] {
  if (!text) return [];
  const hits: RuleHit[] = [];

  if (AZ_PHONE.test(text)) {
    hits.push({
      rule: "phone_number",
      reasonKey: "personal_info",
      severity: 5,
      note: "Contains what looks like an Azerbaijani phone number.",
    });
  }

  if (EMAIL.test(text)) {
    hits.push({
      rule: "email_address",
      reasonKey: "personal_info",
      severity: 5,
      note: "Contains an email address.",
    });
  }

  if (CONTACT_HANDLE.test(text)) {
    hits.push({
      rule: "contact_handle",
      reasonKey: "personal_info",
      severity: 4,
      note: "Contains a messaging handle or profile link.",
    });
  }

  const links = text.match(LINK);
  if (links && links.length >= 4) {
    hits.push({
      rule: "link_flood",
      reasonKey: "spam",
      severity: 2,
      note: `Contains ${links.length} links.`,
    });
  }

  if (CHAR_FLOOD.test(text)) {
    hits.push({
      rule: "char_flood",
      reasonKey: "spam",
      severity: 2,
      note: "Contains a long run of one repeated character.",
    });
  }

  if (STUDENT_ID.test(text)) {
    hits.push({
      rule: "student_id",
      reasonKey: "personal_info",
      severity: 5,
      note: "Contains what looks like a student ID number.",
    });
  }

  return hits;
}

/** The worst thing found, which is what the case's severity becomes. */
export function worstSeverity(hits: RuleHit[]): RuleSeverity | null {
  if (hits.length === 0) return null;
  return hits.reduce<RuleSeverity>((max, h) => (h.severity > max ? h.severity : max), 1);
}
