import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { ConfigService } from "../../config/config.service";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sending mail.
 *
 * Two things about how this is used are load-bearing and easy to undo by
 * accident:
 *
 * 1. THE SEND IS INLINE, never queued. A university email address is never
 *    stored anywhere in this product — only a 32-byte HMAC reaches the
 *    database — so the address exists solely in the request that carried it.
 *    A job queue would have to persist it to send later, which would put a
 *    real student address in a table for the first time and undo the property
 *    the whole identity model rests on. The cost is that this endpoint is as
 *    slow and as available as the mail provider, which is the right trade.
 *
 * 2. IT IS NOT SUPABASE AUTH'S MAILER. Using that would require the university
 *    address to be the Supabase auth email, and identity spec §7.2 trap 1 is
 *    explicit that it must never be: `auth.users.email` is serialised into
 *    every access token, so the token — held on the device, sent to every
 *    service, present in logs — would carry the identity credential. AuthGuard
 *    already alarms on exactly that.
 */
export abstract class MailerService {
  abstract send(mail: OutgoingMail): Promise<void>;
}

/**
 * Real delivery, over plain SMTP.
 *
 * Provider-agnostic on purpose. Deliverability to `.edu.az` mail servers is
 * the actual risk in this feature — university mail is often old, strict, or
 * both — and finding out which provider gets through is an empirical question
 * that should be answerable by changing `SMTP_URL`, not by changing code.
 */
@Injectable()
export class SmtpMailerService extends MailerService {
  private readonly logger = new Logger(SmtpMailerService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    this.transport = createTransport(config.smtpUrl!);
    this.from = config.mailFrom!;
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    // Never the address and never the body. A log line pairing a university
    // email with a Kiksu request id is the join this product spends its whole
    // architecture avoiding, and the body contains a live credential.
    this.logger.log("verification mail sent");
  }
}

/**
 * Keeps the last message in memory instead of sending it.
 *
 * Bound whenever no SMTP is configured, which is `dev-api.sh` and every test.
 *
 * This replaces `OnboardingService.pendingCodeForDevelopment` — a public
 * mutable field that held a live OTP so tests could read it. A one-time code
 * sitting on a long-lived service instance is a bad shape regardless of who
 * reads it, and the capture transport is a better seam anyway: tests assert on
 * the message a student would actually receive rather than on an internal that
 * happens to mirror it.
 */
@Injectable()
export class CaptureMailerService extends MailerService {
  private readonly logger = new Logger(CaptureMailerService.name);

  /** The last message this process "sent". Development and tests only. */
  lastMail: OutgoingMail | null = null;

  async send(mail: OutgoingMail): Promise<void> {
    this.lastMail = mail;
    // Deliberately NOT logging the body. The development OTP log line lives in
    // OnboardingService behind the same gate as the auth bypass; duplicating
    // it here would put a live code in the log on any environment that merely
    // lacked SMTP configuration, which is a different and much weaker gate.
    this.logger.warn(
      `MAIL NOT SENT — no SMTP configured. Captured a message to ${redact(mail.to)}.`,
    );
  }
}

/** `a***@std.bsu.edu.az` — enough to debug routing, not enough to identify anyone. */
function redact(address: string): string {
  const [local, domain] = address.split("@");
  if (!local || !domain) return "<malformed>";
  return `${local.slice(0, 1)}***@${domain}`;
}
