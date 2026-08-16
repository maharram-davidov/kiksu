import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth/public.decorator";

/**
 * `GET /health` — infra liveness probe. Deliberately NOT under `/v1` and NOT in
 * `05-openapi.yaml`: it's a load-balancer/orchestrator contract, not a client-facing
 * API contract, so it isn't versioned and carries none of the response envelope rules
 * that apply to everything else in this service. Excluded from the global `v1` prefix
 * in `main.ts`.
 */
@Public()
@Controller("health")
export class HealthController {
  @Get()
  get(): { status: "ok"; time: string } {
    return { status: "ok", time: new Date().toISOString() };
  }
}
