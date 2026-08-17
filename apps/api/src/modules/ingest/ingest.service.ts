import { Injectable, Logger } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";

export interface IngestVacancyInput {
  /** Stable id within the source. For work.az this is the URL slug. */
  sourceRef: string;
  /** The page a student is sent to. Required: a vacancy with no link is noise. */
  externalUrl: string;
  title: string;
  employerName?: string;
  description?: string;
  kind?: string;
  workMode?: string;
  city?: string;
  isPaid?: boolean;
  stipendMinor?: number;
  applyDeadline?: string;
  requiredSkills?: string[];
}

export interface IngestResult {
  created: number;
  updated: number;
  skipped: number;
  closed: number;
}

/**
 * Ingestion for scraped vacancies.
 *
 * The scraper's job is to parse a page. Everything that needs to be consistent
 * across scrapes — employer identity, upsert keys, what counts as "gone" —
 * lives HERE, because a rule enforced in one scraper is a rule the next
 * scraper gets wrong.
 *
 * ON LEGALITY: whether a given site may be scraped is a question about its
 * terms and robots.txt, not about this code. This endpoint accepts whatever a
 * scraper sends it; deciding a source is permitted is an operational call that
 * has to be made per source before one is pointed at it.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly db: SqlProvider) {}

  /**
   * Upserts a batch from one source.
   *
   * Idempotent by (source, source_ref): re-running a scrape updates rather
   * than duplicating, which is the whole reason source_ref exists. Every row
   * touched gets `last_seen_at`, which is what makes the sweeper below able to
   * tell a closed position from one that simply was not in this page's slice.
   */
  async ingest(source: string, rows: IngestVacancyInput[]): Promise<IngestResult> {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.sourceRef || !row.externalUrl || !row.title.trim()) {
        skipped++;
        continue;
      }

      try {
        const wasCreated = await this.db.transaction(async (tx) => {
          const employerId = await this.resolveEmployer(tx, row.employerName);

          const [existing] = await tx<Array<{ id: string }>>`
            select id from public.vacancy
             where source = ${source} and source_ref = ${row.sourceRef}
          `;

          if (existing) {
            // Deliberately does NOT overwrite status. A vacancy a moderator
            // closed or paused must stay closed even if the source still
            // lists it; a scrape is information, not authority.
            await tx`
              update public.vacancy
                 set title = ${row.title.trim()},
                     description = coalesce(${row.description ?? null}, description),
                     external_url = ${row.externalUrl},
                     source_url = ${row.externalUrl},
                     city = coalesce(${row.city ?? null}, city),
                     is_paid = coalesce(${row.isPaid ?? null}, is_paid),
                     stipend_minor = coalesce(${row.stipendMinor ?? null}, stipend_minor),
                     apply_deadline = coalesce(${row.applyDeadline ?? null}::timestamptz, apply_deadline),
                     required_skills = coalesce(${row.requiredSkills ?? null}, required_skills),
                     employer_id = coalesce(${employerId}, employer_id),
                     last_seen_at = now(),
                     updated_at = now()
               where id = ${existing.id}
            `;
            return false;
          }

          if (!employerId) {
            // employer_id is NOT NULL. A vacancy whose employer cannot be
            // resolved is skipped rather than attached to a placeholder:
            // "Unknown Employer" listings are worse than none, because a
            // student cannot judge whether to trust them.
            throw new SkipRow();
          }

          await tx`
            insert into public.vacancy
              (employer_id, title, description, kind, work_mode, city, is_paid,
               stipend_minor, currency, required_skills, apply_via, external_url,
               apply_deadline, status, posted_at, source, source_ref, source_url,
               first_seen_at, last_seen_at)
            values (${employerId}, ${row.title.trim()}, ${row.description ?? null},
                    ${(row.kind ?? "internship")}::public.vacancy_kind,
                    ${(row.workMode ?? "onsite")}::public.work_mode,
                    ${row.city ?? null}, ${row.isPaid ?? false},
                    ${row.stipendMinor ?? null}, 'AZN',
                    ${row.requiredSkills ?? []}, 'external', ${row.externalUrl},
                    ${row.applyDeadline ?? null}::timestamptz, 'active', now(),
                    ${source}, ${row.sourceRef}, ${row.externalUrl}, now(), now())
          `;
          return true;
        });

        if (wasCreated) created++;
        else updated++;
      } catch (e) {
        if (e instanceof SkipRow) {
          skipped++;
          continue;
        }
        // One malformed row must not abandon the rest of the batch. A scrape
        // that fails entirely because of a single odd listing is a scrape
        // nobody can rely on.
        this.logger.warn(`ingest: skipped ${source}/${row.sourceRef}: ${String(e)}`);
        skipped++;
      }
    }

    return { created, updated, skipped, closed: 0 };
  }

  /**
   * Closes vacancies this source has stopped listing.
   *
   * The gap this fills: `apply_deadline` handles positions that expire on
   * schedule, but a position filled early simply disappears from the source
   * and would otherwise sit in the feed forever. Absence from a scrape is the
   * only signal that exists.
   *
   * `notSeenForMinutes` guards against a partial scrape closing everything: if
   * the scraper crashed halfway, the rows it did not reach are minutes old,
   * not hours, and survive.
   */
  async closeMissing(source: string, notSeenForMinutes = 24 * 60): Promise<number> {
    const rows = await this.db.sql<Array<{ id: string }>>`
      update public.vacancy
         set status = 'closed', closed_at = now(), updated_at = now()
       where source = ${source}
         and status = 'active'
         and last_seen_at < now() - (${notSeenForMinutes} || ' minutes')::interval
      returning id
    `;
    if (rows.length > 0) {
      this.logger.log(`closed ${rows.length} vacancies no longer listed by ${source}`);
    }
    return rows.length;
  }

  /**
   * Finds or creates an employer by folded name.
   *
   * Centralised here rather than in the scraper: "Kapital Bank", "Kapital bank"
   * and "KAPITAL BANK" must be one employer, and a rule enforced in one
   * scraper is a rule the next scraper gets wrong.
   */
  private async resolveEmployer(
    tx: Parameters<Parameters<SqlProvider["transaction"]>[0]>[0],
    name: string | undefined,
  ): Promise<string | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;

    const [existing] = await tx<Array<{ id: string }>>`
      select id from public.employer where name_key = util.fold_handle(${trimmed})
    `;
    if (existing) return existing.id;

    const [created] = await tx<Array<{ id: string }>>`
      insert into public.employer (slug, name, name_key, logo_initials, is_active, is_verified)
      values (util.fold_handle(${trimmed}), ${trimmed}, util.fold_handle(${trimmed}),
              upper(left(${trimmed}, 2)),
              true,
              -- Scraped employers are NOT verified. The badge means Kiksu
              -- checked, and nobody checked this one.
              false)
      -- The predicate must be repeated: Postgres cannot infer a PARTIAL
      -- unique index from the column list alone.
      on conflict (name_key) where name_key is not null
        do update set name = excluded.name
      returning id
    `;
    return created?.id ?? null;
  }
}

/** Thrown to skip a single row without abandoning the batch. */
class SkipRow extends Error {}
