import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import postgres from "postgres";
import { ConfigService } from "../../config/config.service";

/**
 * A SECOND connection pool, for the verification service only.
 *
 * WHY THIS EXISTS SEPARATELY: `identity.*` holds Layer 1 — the sealed link
 * between a real student and their pseudonym. The main pool (SqlProvider) has
 * no USAGE on that schema and must never gain any; invariant 1 in
 * scripts/schema-invariants.sql fails the build if it does. So verification
 * cannot simply borrow the main connection: it needs its own credentials,
 * authenticating as `kiksu_identity_svc`.
 *
 * That split is the whole point. A SQL-injection hole or a careless join in the
 * forum or timetable code cannot reach identity data, because the connection
 * those modules hold is not permitted to see it — not by policy, by grant.
 *
 * OPERATIONALLY: `DATABASE_URL_IDENTITY` must be a distinct credential with
 * least privilege. Pointing it at the same superuser as DATABASE_URL collapses
 * the boundary and defeats the design; the constructor says so loudly when it
 * detects that outside development.
 */
@Injectable()
export class IdentitySqlProvider implements OnModuleDestroy {
  private readonly logger = new Logger(IdentitySqlProvider.name);
  readonly sql: postgres.Sql;

  constructor(config: ConfigService) {
    const url = config.identityDatabaseUrl;

    if (url === config.databaseUrl) {
      const message =
        "DATABASE_URL_IDENTITY is identical to DATABASE_URL. The Layer 1 " +
        "boundary is not enforced: any code holding the main pool can reach " +
        "identity.*. Provision a separate kiksu_identity_svc credential.";
      if (config.nodeEnv === "production") throw new Error(message);
      this.logger.warn(`${message} Tolerated in ${config.nodeEnv} only.`);
    }

    this.sql = postgres(url, {
      max: 4, // verification is low-volume; a small pool limits blast radius
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {},
      transform: { undefined: null },
    });
  }

  transaction<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn) as Promise<T>;
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
