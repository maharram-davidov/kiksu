import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IdentitySqlProvider } from "../../common/db/identity-sql.provider";
import { ConfigService } from "../../config/config.service";

/** How long a minted URL stays usable. Long enough to load an image, not to share one. */
const SIGNED_URL_TTL_SECONDS = 60;

export interface EvidenceUrlDto {
  url: string;
  expires_in_seconds: number;
}

/**
 * Serves a student card image to a reviewer, and records that it happened.
 *
 * This is the single most sensitive read in the product. An identity document
 * is the most sensitive thing Kiksu ever holds, the reviewer is a human who
 * will see a real name, and Layer 1 exists specifically to keep that name away
 * from everything else. Three things follow, and none of them is optional:
 *
 * 1. THE LOG IS WRITTEN BEFORE THE URL IS MINTED. `identity.access_log` is
 *    append-only by trigger and the schema's own header says the log write
 *    comes first. Logging afterwards means a crash, a timeout or a thrown
 *    error between the two leaves an unrecorded look at a student's ID.
 *    Logging first can at worst record a look that did not happen, which is a
 *    false positive in an audit — the safe direction to be wrong in.
 *
 * 2. IT GOES THROUGH THE IDENTITY CONNECTION. The main pool has no grant on
 *    `identity`, by invariant 1. This service therefore takes
 *    `IdentitySqlProvider`, the second pool with its own least-privilege
 *    credential, and nothing here may be moved onto the main one for
 *    convenience.
 *
 * 3. THE URL IS SHORT-LIVED AND NEVER STORED. 60 seconds, minted per view.
 *    A durable link to a private bucket object is the same leak as a public
 *    bucket, only slower to notice.
 *
 * The read-volume budget in identity spec §7.4 is the detector this feeds:
 * tens of reads a day is normal, and a dashboard on this table is the cheapest
 * possible alarm for someone having wired identity into a hot path.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly identity: IdentitySqlProvider,
    private readonly config: ConfigService,
  ) {}

  async signedUrlFor(attemptId: string, staffId: string): Promise<EvidenceUrlDto> {
    const [attempt] = await this.identity.sql<Array<{
      subject_id: string | null; evidence_path: string | null; state: string;
    }>>`
      select subject_id, evidence_path, state::text
        from identity.verification_attempt
       where id = ${attemptId}
    `;
    if (!attempt) throw new NotFoundException("case_not_found");

    // Cleared on decision so the sweeper can delete the file — a decided case
    // has no further use for the image. A reviewer asking for one is asking
    // for something that should already be gone.
    if (!attempt.evidence_path) throw new NotFoundException("evidence_unavailable");

    // ---- log first, always ----
    await this.identity.sql`
      insert into identity.access_log
        (purpose, function_name, subject_id, actor_ref, justification)
      values ('verification', 'admin.evidence.signed_url', ${attempt.subject_id},
              ${staffId}, 'staff opened student card for manual review')
    `;

    const url = await this.mintSignedUrl(attempt.evidence_path);
    return { url, expires_in_seconds: SIGNED_URL_TTL_SECONDS };
  }

  /**
   * Supabase Storage's sign endpoint, called directly.
   *
   * Deliberately not via `@supabase/supabase-js`: the API has no Supabase
   * client today and one signed POST does not justify pulling the SDK — and
   * every additional dependency that holds the service-role key is another
   * place it can leak.
   */
  private async mintSignedUrl(path: string): Promise<string> {
    const bucket = this.config.supabaseEvidenceBucket;
    const base = this.config.supabaseUrl.replace(/\/$/, "");
    const endpoint = `${base}/storage/v1/object/sign/${bucket}/${path}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        // SECURITY: server-only. This is the value env.schema.ts says must
        // never reach a client, a log line or a URL — note it is a header
        // here, not a query parameter, for exactly that reason.
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    });

    if (!res.ok) {
      // The reviewer sees a generic failure; the operator sees the status. The
      // storage response body can echo the object path, which is a per-student
      // key, so it is deliberately not interpolated into either.
      this.logger.error(`storage sign failed: HTTP ${res.status} for bucket ${bucket}`);
      throw new BadRequestException("evidence_unavailable");
    }

    const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = body.signedURL ?? body.signedUrl;
    if (!signed) {
      this.logger.error("storage sign returned no URL");
      throw new BadRequestException("evidence_unavailable");
    }

    return signed.startsWith("http") ? signed : `${base}/storage/v1${signed}`;
  }
}
