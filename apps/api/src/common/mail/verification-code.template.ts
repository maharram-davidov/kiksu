import type { Locale } from "../locale/locale";
import type { OutgoingMail } from "./mailer.service";

/**
 * The one-time code email.
 *
 * WHAT THIS MESSAGE MUST NOT SAY is the part worth reading. It lands in a
 * university mailbox, which is administered by the university — not by the
 * student. A subject line or body describing Kiksu as an anonymous student
 * forum would disclose to that administrator that this person is joining one,
 * which is precisely the association the product exists to prevent. So the
 * copy says: here is your code, it expires, ignore this if it was not you. It
 * does not describe what the account is for, does not mention anonymity,
 * forums, reviews or the marketplace, and does not link anywhere.
 *
 * COPY STATUS: written to match the design's register, and NOT reviewed by a
 * native speaker. It is queued behind the same review as the generated-handle
 * wordlist and the reviews strings. The Azerbaijani here reaches real students
 * before almost anything else in the product does, so it is worth doing
 * properly rather than shipping a machine draft.
 */

interface Copy {
  subject: string;
  greeting: string;
  codeLabel: string;
  expiry: (minutes: number) => string;
  ignore: string;
  signature: string;
}

const COPY: Record<Locale, Copy> = {
  az: {
    subject: "Kiksu təsdiq kodu",
    greeting: "Təsdiq kodun:",
    codeLabel: "KOD",
    expiry: (m) => `Kod ${m} dəqiqə ərzində etibarlıdır.`,
    ignore: "Bu kodu sən istəməmisənsə, bu məktubu nəzərə alma. Heç bir hesab yaradılmır.",
    signature: "Kiksu",
  },
  ru: {
    subject: "Код подтверждения Kiksu",
    greeting: "Твой код подтверждения:",
    codeLabel: "КОД",
    expiry: (m) => `Код действителен ${m} минут.`,
    ignore: "Если ты не запрашивал этот код, просто проигнорируй письмо. Аккаунт не создаётся.",
    signature: "Kiksu",
  },
  en: {
    subject: "Your Kiksu verification code",
    greeting: "Your verification code:",
    codeLabel: "CODE",
    expiry: (m) => `The code is valid for ${m} minutes.`,
    ignore: "If you did not request this code, ignore this message. No account is created.",
    signature: "Kiksu",
  },
};

export function verificationCodeMail(params: {
  to: string;
  code: string;
  ttlMinutes: number;
  locale: Locale;
}): OutgoingMail {
  const c = COPY[params.locale];

  const text = [
    c.greeting,
    "",
    params.code,
    "",
    c.expiry(params.ttlMinutes),
    c.ignore,
    "",
    c.signature,
  ].join("\n");

  // Deliberately minimal HTML: no images, no external stylesheet, no tracking
  // pixel, no link. A remote image would report to Kiksu that this mailbox
  // opened the message, which is a signal about a real person tied to a real
  // address — the one identifier this product refuses to hold.
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#141c24">',
    `<p>${escapeHtml(c.greeting)}</p>`,
    `<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;`,
    `letter-spacing:8px;font-weight:700;margin:20px 0">${escapeHtml(params.code)}</p>`,
    `<p style="color:#6d7580;font-size:13px">${escapeHtml(c.expiry(params.ttlMinutes))}</p>`,
    `<p style="color:#6d7580;font-size:13px">${escapeHtml(c.ignore)}</p>`,
    `<p style="color:#6d7580;font-size:13px">${escapeHtml(c.signature)}</p>`,
    "</div>",
  ].join("");

  return { to: params.to, subject: c.subject, text, html };
}

/**
 * The code is server-generated digits, so this cannot currently matter — which
 * is exactly why it is here. The day someone interpolates a university name or
 * anything else caller-influenced into this template, it should already be
 * safe rather than becoming a bug nobody looks for in an email template.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
