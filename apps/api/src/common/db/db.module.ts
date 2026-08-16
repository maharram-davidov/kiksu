import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { SqlProvider } from "./sql.provider";

/** Global so feature modules inject SqlProvider without re-importing this. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SqlProvider],
  exports: [SqlProvider],
})
export class DbModule {}
