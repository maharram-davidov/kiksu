import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import postgres from "postgres";
import { ConfigService } from "../../config/config.service";

/**
 * The single Postgres connection pool for the API.
 *
 * WHY A DIRECT CONNECTION AND NOT postgrest / supabase-js:
 * Kiksu's client never holds a table grant — every read that touches identity
 * and every write goes through this server layer, which authorises in code
 * (docs/01-schema-notes.md, "The access model"). PostgREST is built for the
 * opposite shape. The queries this API actually needs — keyset pagination with
 * a signed cursor, alias allocation under a row lock, counter-consistent
 * writes — are plain SQL and awkward to express through PostgREST.
 *
 * WHICH ROLE: the connection authenticates as the Supabase `service_role`
 * equivalent, which carries BYPASSRLS (docs/07-supabase-deviations.md,
 * deviation 1). RLS is therefore NOT protecting these queries. That is
 * deliberate and it puts the burden here: every query in this codebase is
 * responsible for its own scoping. When you write one, assume nothing is
 * filtering it for you.
 *
 * WHAT THIS CONNECTION MUST NEVER DO: read `identity.*` or `career.*`. Those
 * schemas have no grant to this role and the attempt will fail loudly, which
 * is the intended behaviour — see invariant 1. Verification and career flows
 * belong to separate services with their own credentials.
 */
@Injectable()
export class SqlProvider implements OnModuleDestroy {
  readonly sql: postgres.Sql;

  constructor(config: ConfigService) {
    this.sql = postgres(config.databaseUrl, {
      max: config.databasePoolMax,
      idle_timeout: 30,
      connect_timeout: 10,
      // Supabase's pooler does not support prepared statements in transaction
      // mode; leaving these on produces intermittent "prepared statement
      // already exists" failures that only appear under concurrency.
      prepare: false,
      onnotice: () => {},
      transform: { undefined: null },
    });
  }

  /**
   * Runs `fn` inside a transaction. Use this for anything that must be atomic
   * with an alias allocation: internal.allocate_thread_alias() takes a row
   * lock on the post, and the identity spec requires allocation to happen in
   * the SAME transaction as the content insert, so a rolled-back post cannot
   * strand an ordinal.
   */
  transaction<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn) as Promise<T>;
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
