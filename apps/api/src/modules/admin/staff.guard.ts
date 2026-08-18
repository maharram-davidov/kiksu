import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../../common/errors/app-error";
import { SqlProvider } from "../../common/db/sql.provider";

/** Same shape Postgres accepts for `uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Staff-only routes.
 *
 * Staff membership is looked up per request from `moderation.staff` rather
 * than carried as a JWT claim. That is deliberate: a claim is only as fresh as
 * the last token mint, and revoking a moderator has to take effect NOW, not
 * whenever their session happens to refresh. The identity spec makes the same
 * argument about per-board scope.
 *
 * A non-staff caller gets `not_found`, not `forbidden`. Whether an admin
 * surface exists at a given path is not something an ordinary student needs
 * confirmed.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly db: SqlProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = req.kiksu;
    if (!ctx) throw new AppError("not_found");

    // `moderation.staff.auth_user_id` is a uuid column, so a non-uuid subject
    // makes Postgres raise rather than return no rows — which surfaces as
    // `500 internal_error` instead of the `not_found` below. That is not
    // merely an ugly error: a 500 CONFIRMS the route exists, which is the one
    // bit this guard is written to withhold. Checked here rather than trusted
    // from upstream, because upstream got it wrong once already (the
    // development bypass used to synthesise `dev-auth-<uuid>`).
    if (!UUID_PATTERN.test(ctx.authUserId)) throw new AppError("not_found");

    const [staff] = await this.db.sql<Array<{ id: string; role: string; university_scope: string | null }>>`
      select id, role::text, university_scope
        from moderation.staff
       where auth_user_id = ${ctx.authUserId}
         and is_active
    `;
    if (!staff) throw new AppError("not_found");

    req.kiksuStaff = { id: staff.id, role: staff.role, universityScope: staff.university_scope };
    return true;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    /** Set by {@link StaffGuard}. Absent on every non-staff route. */
    kiksuStaff?: { id: string; role: string; universityScope: string | null };
  }
}
