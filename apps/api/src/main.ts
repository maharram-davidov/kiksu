import "reflect-metadata";
import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "./config/config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  const config = app.get(ConfigService);

  // §1.1: the version is a path segment. `/health` is infra-only and stays outside it
  // (see health.controller.ts's doc comment).
  app.setGlobalPrefix("v1", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  // No global validation pipe: this scaffold has no request DTOs to validate (its one
  // real endpoint, GET /v1/bootstrap, takes no input). Endpoint implementers adding
  // request bodies should add `class-validator`/`class-transformer` (neither is a
  // dependency of this package yet — add them when the first DTO needs them) or a zod
  // schema, and turn a failure into `AppError("validation_failed", { details: { fields } })`
  // per §3.1 — never let a raw class-validator error message reach a response.

  await app.listen(config.port);
  Logger.log(`Kiksu API listening on :${config.port} (${config.nodeEnv})`, "Bootstrap");
}

bootstrap().catch((err: unknown) => {
  // A boot failure (including a bad .env — see config/env.schema.ts) must crash the
  // process loudly, never limp along serving requests it can't correctly authorise.
  // eslint-disable-next-line no-console
  console.error("Kiksu API failed to start:", err);
  process.exit(1);
});
