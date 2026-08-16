import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "kiksu:isPublic";

/**
 * Marks a route (or a whole controller) as not requiring authentication —
 * `GET /v1/bootstrap` and `GET /v1/health` are the only two in this scaffold.
 * `AuthGuard` is registered globally (`main.ts`) precisely so that forgetting this
 * decorator is a fail-closed mistake (a new route defaults to requiring a token) and
 * marking a route `@Public()` is an explicit, greppable decision instead.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
