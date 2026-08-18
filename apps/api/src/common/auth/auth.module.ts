import { Module } from "@nestjs/common";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { ConfigService } from "../../config/config.service";
import { AuthGuard } from "./auth.guard";
import { AuthObjectsCheck } from "./auth-objects.check";
import { DbEpochService, EpochService } from "./epoch.service";
import { JWKS_RESOLVER, JwtVerifierService } from "./jwt-verifier.service";
import { SecurityMetricsService } from "./security-metrics.service";

@Module({
  providers: [
    {
      provide: JWKS_RESOLVER,
      useFactory: (config: ConfigService): JWTVerifyGetKey => createRemoteJWKSet(new URL(config.supabaseJwksUrl)),
      inject: [ConfigService],
    },
    JwtVerifierService,
    // Backed by internal.auth_epoch. Bound unconditionally, including under the
    // development bypass: the guard short-circuits before the epoch check there,
    // but tier grants still have to bump, or the counter is wrong the first time
    // a real token is minted. Redis and LISTEN/NOTIFY are still not built — see
    // the class doc for what that costs and why it stays inside §7.4's target.
    { provide: EpochService, useClass: DbEpochService },
    SecurityMetricsService,
    AuthGuard,
    // Boot-time assertion that migration 0021 reached this database. A missing
    // hook is silent everywhere else — see the class doc.
    AuthObjectsCheck,
  ],
  exports: [JwtVerifierService, EpochService, SecurityMetricsService, AuthGuard],
})
export class AuthModule {}
