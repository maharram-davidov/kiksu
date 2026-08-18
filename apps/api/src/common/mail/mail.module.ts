import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { ConfigService } from "../../config/config.service";
import { CaptureMailerService, MailerService, SmtpMailerService } from "./mailer.service";

/**
 * Global, like DbModule and ConfigModule, so a feature module can send mail
 * without importing this and without the DI-wiring mistakes that pattern
 * invites.
 *
 * Which implementation is bound is decided by configuration alone: SMTP if
 * `SMTP_URL` and `MAIL_FROM` are set, capture otherwise. `parseEnv()` refuses
 * to boot in production without them, so "capture" cannot be the production
 * binding — an API accepting signups it cannot deliver codes for is worse than
 * one that will not start.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MailerService,
      useFactory: (config: ConfigService): MailerService => {
        if (config.smtpUrl && config.mailFrom) return new SmtpMailerService(config);
        new Logger("MailModule").warn(
          "No SMTP configured — verification codes will be captured in memory, not sent. " +
            "parseEnv() refuses to boot this way in production.",
        );
        return new CaptureMailerService();
      },
      inject: [ConfigService],
    },
  ],
  exports: [MailerService],
})
export class MailModule {}
