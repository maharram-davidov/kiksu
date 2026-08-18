import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { SqlProvider } from "../db/sql.provider";
import { ConfigService } from "../../config/config.service";

/**
 * Confirms at boot that the database objects token minting depends on are
 * actually present.
 *
 * WHY THIS IS WORTH A STARTUP CHECK: if migration 0021 has not been applied to
 * whatever database this instance is pointed at, `AuthGuard` behaves perfectly
 * and every single request still fails. The hook has no projection to read, so
 * it emits no claims, so `parseTrustedAppMetadata` returns null, so every route
 * answers `token_invalid`. Nothing in that chain is an error anywhere — each
 * layer is doing exactly what it should — which makes it close to
 * undiagnosable from logs. Failing at boot with one sentence is worth a query.
 *
 * WHAT THIS CANNOT CHECK, and it is the more likely mistake: whether the hook
 * is REGISTERED with Supabase Auth. That lives in GoTrue's configuration, not
 * in Postgres, so no query here can see it. An unregistered hook produces
 * exactly the same symptom — claimless tokens, blanket `token_invalid` — so the
 * warning below names it explicitly rather than letting a green startup imply
 * more than it proves.
 */
@Injectable()
export class AuthObjectsCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger("AuthObjectsCheck");

  constructor(
    private readonly db: SqlProvider,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = await this.findMissing();

    if (missing.length > 0) {
      const detail =
        `Access token objects are missing: ${missing.join(", ")}. ` +
        "Apply supabase/migrations/0021_auth_claims_hook.sql. Without them every " +
        "minted token carries no claims and every authenticated route answers " +
        "token_invalid.";

      // Under the development bypass the guard never reads a token, so a
      // missing hook is not fatal and refusing to boot would break the one
      // workflow that does not need it.
      if (this.config.devAuthAppUserId) {
        this.logger.warn(`${detail} (Tolerated: the development auth bypass is active.)`);
        return;
      }
      throw new Error(detail);
    }

    this.logger.log(
      "Access token objects present. NOTE: this cannot verify that " +
        "auth_hooks.custom_access_token_hook is registered in Supabase Auth's " +
        "settings — that is a project configuration, not a database object. An " +
        "unregistered hook looks identical to a missing one from the client: " +
        "every token is claimless.",
    );
  }

  /** Names of the required objects that are absent, in migration order. */
  private async findMissing(): Promise<string[]> {
    const [row] = await this.db.sql<Array<{ epoch: boolean; claims: boolean; hook: boolean }>>`
      select
        to_regclass('internal.auth_epoch')   is not null as epoch,
        to_regclass('internal.token_claims') is not null as claims,
        exists (
          select 1 from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'auth_hooks'
             and p.proname = 'custom_access_token_hook'
        ) as hook
    `;

    const missing: string[] = [];
    if (!row?.epoch) missing.push("internal.auth_epoch");
    if (!row?.claims) missing.push("internal.token_claims");
    if (!row?.hook) missing.push("auth_hooks.custom_access_token_hook");
    return missing;
  }
}
