import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { SqlProvider } from "./sql.provider";
import { IdentitySqlProvider } from "./identity-sql.provider";

/** Global so feature modules inject SqlProvider without re-importing this. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SqlProvider, IdentitySqlProvider],
  exports: [SqlProvider, IdentitySqlProvider],
})
export class DbModule {}
