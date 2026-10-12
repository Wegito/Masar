import type { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import { SmtpMailer } from '../src/modules/mail/smtp.mailer.js';

/** Mailpit aus compose.yaml (lokal) bzw. als Service-Container (CI). */
const MAILPIT_API = process.env.TEST_MAILPIT_API ?? 'http://localhost:8025/api/v1';

const config = {
  get: (key: keyof Env) =>
    ({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'Masar <no-reply@masar.invalid>' })[
      key as 'SMTP_URL'
    ],
} as unknown as ConfigService<Env, true>;

describe('E-Mail-Versand über echtes SMTP (Mailpit)', () => {
  const mailer = new SmtpMailer(config);

  afterAll(() => {
    mailer.onModuleDestroy();
  });

  it('stellt eine arabische Nachricht unverändert zu', async () => {
    const to = `smtp-test-${Date.now()}@masar.example`;
    await mailer.send({
      to,
      subject: 'دعوة للانضمام إلى مسار',
      text: 'نص الرسالة\nhttps://example.test/#token=abc',
    });

    const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as {
      messages: { Subject: string; From: { Address: string } }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      Subject: 'دعوة للانضمام إلى مسار',
      From: { Address: 'no-reply@masar.invalid' },
    });
  });
});
