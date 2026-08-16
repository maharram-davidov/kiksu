import { Global, Module } from "@nestjs/common";
import { IdempotencyMiddleware } from "./idempotency.middleware";
import { IdempotencyStore, InMemoryIdempotencyStore } from "./idempotency.store";

/**
 * Global so a feature module can do `consumer.apply(IdempotencyMiddleware).forRoutes(...)`
 * in its own `configure()` without importing this module explicitly — mirrors how
 * `ConfigModule` is globally available. See `idempotency.middleware.ts` for wiring
 * example and the SECURITY/correctness note on `InMemoryIdempotencyStore`.
 */
@Global()
@Module({
  providers: [{ provide: IdempotencyStore, useClass: InMemoryIdempotencyStore }, IdempotencyMiddleware],
  exports: [IdempotencyStore, IdempotencyMiddleware],
})
export class IdempotencyModule {}
