import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { IntervalJob } from '../src/common/interval-job.js';
import { BookingExpiryJob } from '../src/modules/bookings/booking-expiry.job.js';
import { Mailer } from '../src/modules/mail/mailer.js';
import { OutboxWorker } from '../src/modules/outbox/outbox.worker.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/** Löst einen Durchgang des Takts sofort aus, statt auf das Intervall zu warten. */
function tick(job: IntervalJob): void {
  (job as unknown as { tick: () => void }).tick();
}

describe('Herunterfahren (Ende zu Ende)', () => {
  it('hält Jobs und HTTP-Server an, bevor Datenbank und SMTP schließen', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.listen(0, '127.0.0.1');

    const events: string[] = [];
    const prisma = app.get(PrismaService);
    const disconnect = prisma.$disconnect.bind(prisma);
    vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      events.push('db-disconnect');
      await disconnect();
    });
    // In dieser App ist der echte SMTP-Versand eingebunden; er verbindet sich erst beim Senden.
    const mailer: unknown = app.get(Mailer);
    const { transporter } = mailer as { transporter: { close: () => void } };
    const closeTransport = transporter.close.bind(transporter);
    vi.spyOn(transporter, 'close').mockImplementation(() => {
      events.push('smtp-close');
      closeTransport();
    });
    app.getHttpServer().on('close', () => events.push('http-close'));

    // Ein Durchgang je Job läuft beim Herunterfahren noch und braucht danach die Datenbank.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowRun = (name: string) => async () => {
      await gate;
      await prisma.$queryRaw`SELECT 1`;
      events.push(`${name}-done`);
      return { trips: 0, expired: 0, done: 0, retried: 0, failed: 0 };
    };
    const outbox = app.get(OutboxWorker);
    const expiry = app.get(BookingExpiryJob);
    vi.spyOn(outbox, 'runOnce').mockImplementation(slowRun('outbox'));
    vi.spyOn(expiry, 'runOnce').mockImplementation(slowRun('expiry'));
    tick((outbox as unknown as { job: IntervalJob }).job);
    tick((expiry as unknown as { job: IntervalJob }).job);

    const closing = app.close();
    setTimeout(release, 100);
    await closing;

    // Beide Durchgänge enden vor dem Schließen des HTTP-Servers, Datenbank und SMTP zuletzt.
    const order = events.map((event) => (event.endsWith('-done') ? 'job-done' : event));
    expect(order.slice(0, 3)).toEqual(['job-done', 'job-done', 'http-close']);
    expect(order.slice(3).toSorted()).toEqual(['db-disconnect', 'smtp-close']);
  });
});
