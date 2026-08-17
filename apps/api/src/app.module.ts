import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./common/db/db.module";
import { AuthModule } from "./common/auth/auth.module";
import { AuthGuard } from "./common/auth/auth.guard";
import { KiksuExceptionFilter } from "./common/errors/http-exception.filter";
import { PaginationModule } from "./common/pagination/pagination.module";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { IdempotencyModule } from "./common/idempotency/idempotency.module";
import { RequestIdMiddleware } from "./common/request/request-id.middleware";
import { HealthModule } from "./modules/health/health.module";
import { BootstrapModule } from "./modules/bootstrap/bootstrap.module";
import { TimetableModule } from "./modules/timetable/timetable.module";
import { ForumModule } from "./modules/forum/forum.module";

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    PaginationModule,
    RateLimitModule,
    IdempotencyModule,
    HealthModule,
    BootstrapModule,
    TimetableModule,
    ForumModule,
  ],
  providers: [
    // Fail-closed by default: every route requires a verified caller unless it opts
    // out with @Public(). See common/auth/public.decorator.ts.
    { provide: APP_GUARD, useClass: AuthGuard },
    // Every non-2xx response goes through one place — see the class doc for why.
    { provide: APP_FILTER, useClass: KiksuExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs before guards/interceptors/handlers on every route, so a request id exists
    // even for a request that fails inside AuthGuard. "*path" (not "*") is Express 5 /
    // path-to-regexp v8's named-wildcard syntax for "match everything".
    consumer.apply(RequestIdMiddleware).forRoutes("*path");
  }
}
