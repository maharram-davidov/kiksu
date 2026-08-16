import { Module } from "@nestjs/common";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { ConfigService } from "../../config/config.service";
import { AuthGuard } from "./auth.guard";
import { EpochService, NoopEpochService } from "./epoch.service";
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
    // See the SECURITY warning on NoopEpochService: this must be replaced with a
    // Redis/LISTEN-NOTIFY-backed implementation before production traffic depends on
    // token revocation actually working.
    { provide: EpochService, useClass: NoopEpochService },
    SecurityMetricsService,
    AuthGuard,
  ],
  exports: [JwtVerifierService, EpochService, SecurityMetricsService, AuthGuard],
})
export class AuthModule {}
