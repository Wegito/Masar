import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import type { Env } from '../../config/env.js';
import { type MailMessage, Mailer } from './mailer.js';

/** SMTP-Versand; in der Entwicklung an Mailpit (compose.yaml). */
@Injectable()
export class SmtpMailer extends Mailer implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.transporter = createTransport({
      url: config.get('SMTP_URL', { infer: true }),
      // Ohne Grenzen wartet nodemailer Minuten; eine Anfrage soll nicht am Mailserver hängen.
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}

@Global()
@Module({ providers: [{ provide: Mailer, useClass: SmtpMailer }], exports: [Mailer] })
export class MailModule {}
