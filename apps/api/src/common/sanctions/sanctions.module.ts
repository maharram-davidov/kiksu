import { Global, Module } from "@nestjs/common";
import { SanctionsService } from "./sanctions.service";

/**
 * Global, like DbModule and MailModule. Every write path in the product needs
 * this check, and requiring six feature modules to remember an import is how
 * one of them quietly ends up unguarded.
 */
@Global()
@Module({
  providers: [SanctionsService],
  exports: [SanctionsService],
})
export class SanctionsModule {}
