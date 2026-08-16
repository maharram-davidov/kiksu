import { Global, Module } from "@nestjs/common";
import { parseEnv, type Env } from "./env.schema";
import { ConfigService } from "./config.service";

export const ENV_TOKEN = Symbol("ENV_TOKEN");

/**
 * Global module so every other module can inject `ConfigService` without re-importing
 * this one. Validation happens once, here, at module-instantiation time — which is
 * boot time — so a bad `.env` fails the process before it starts accepting traffic.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV_TOKEN,
      useFactory: (): Env => parseEnv(process.env),
    },
    {
      provide: ConfigService,
      useFactory: (env: Env) => new ConfigService(env),
      inject: [ENV_TOKEN],
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
