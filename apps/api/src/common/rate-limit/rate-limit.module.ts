import { Module } from "@nestjs/common";
import { AccountAgeService, NoopAccountAgeService } from "./account-age.service";
import { InMemoryRateLimitStore, RateLimitStore } from "./rate-limit.store";
import { RateLimitGuard } from "./rate-limit.guard";
import { RateLimiterService } from "./rate-limit.service";

@Module({
  providers: [
    // See the SECURITY/correctness warnings on InMemoryRateLimitStore and
    // NoopAccountAgeService — both must be replaced before a multi-instance production
    // deploy.
    { provide: RateLimitStore, useClass: InMemoryRateLimitStore },
    { provide: AccountAgeService, useClass: NoopAccountAgeService },
    RateLimiterService,
    RateLimitGuard,
  ],
  exports: [RateLimiterService, RateLimitGuard, RateLimitStore, AccountAgeService],
})
export class RateLimitModule {}
