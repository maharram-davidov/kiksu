import { Injectable } from "@nestjs/common";
import type { Env } from "./env.schema";

/**
 * Typed accessor over the validated environment. Nothing downstream reads
 * `process.env` directly — that keeps `parseEnv` the single validation choke point
 * and makes every config value's type checked at compile time.
 */
@Injectable()
export class ConfigService {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env["NODE_ENV"] {
    return this.env.NODE_ENV;
  }

  get port(): number {
    return this.env.PORT;
  }

  get supabaseUrl(): string {
    return this.env.SUPABASE_URL;
  }

  /**
   * SECURITY: server-only. See the SECURITY note in `env.schema.ts`. Do not pass this
   * value into any response, log line, or header.
   */
  get supabaseServiceRoleKey(): string {
    return this.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  get supabaseJwksUrl(): string {
    return this.env.SUPABASE_JWKS_URL ?? `${this.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  }

  get supabaseJwtAudience(): string {
    return this.env.SUPABASE_JWT_AUDIENCE;
  }

  get cursorHmacSecret(): string {
    return this.env.CURSOR_HMAC_SECRET;
  }

  get idempotencyStore(): Env["IDEMPOTENCY_STORE"] {
    return this.env.IDEMPOTENCY_STORE;
  }

  get rateLimitStore(): Env["RATE_LIMIT_STORE"] {
    return this.env.RATE_LIMIT_STORE;
  }

  get redisUrl(): string | undefined {
    return this.env.REDIS_URL;
  }

  get storeUrls(): { ios: string; android: string } {
    return { ios: this.env.IOS_STORE_URL, android: this.env.ANDROID_STORE_URL };
  }

  get minSupportedClient(): { ios: string; android: string } {
    return { ios: this.env.MIN_SUPPORTED_CLIENT_IOS, android: this.env.MIN_SUPPORTED_CLIENT_ANDROID };
  }

  get recommendedClient(): { ios: string; android: string } {
    return { ios: this.env.RECOMMENDED_CLIENT_IOS, android: this.env.RECOMMENDED_CLIENT_ANDROID };
  }
}
