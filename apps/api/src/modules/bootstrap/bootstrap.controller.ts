import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../../common/auth/public.decorator";
import { BootstrapService } from "./bootstrap.service";
import type { BootstrapResponse } from "./bootstrap.types";

/**
 * `GET /v1/bootstrap` — §1.3. Unauthenticated (`@Public()`) and cacheable for 300 s,
 * matching the OpenAPI contract's `Cache-Control` example exactly.
 */
@Public()
@Controller("bootstrap")
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=300")
  get(): BootstrapResponse {
    return this.bootstrap.getBootstrap();
  }
}
