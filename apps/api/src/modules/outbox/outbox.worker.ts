import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Clock } from '../../common/clock.js';
import { IntervalJob } from '../../common/interval-job.js';
import { errorSummary } from '../../common/logging.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BookingMailHandler } from './booking-mail.handler.js';
import { afterFailure, OUTBOX_LEASE_MS } from './domain/retry.js';
import {
  BOOKING_EVENT_TYPES,
  type BookingEventPayload,
  type BookingEventType,
} from './outbox.service.js';

const OUTBOX_INTERVAL_MS = 10_000;
const OUTBOX_BATCH_SIZE = 20;

interface ClaimedEntry {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxRunResult {
  done: number;
  retried: number;
  failed: number;
}

function isBookingEvent(type: string): type is BookingEventType {
  return (BOOKING_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Arbeitet die Outbox ab (ADR 0021): Einträge werden in einer kurzen Transaktion abgeholt
 * (`FOR UPDATE SKIP LOCKED`), der Versuch wird dabei mitgezählt und eine Sperrfrist gesetzt. Erst
 * danach folgt der Versand außerhalb jeder Transaktion. Ein Absturz mitten im Versand lässt den
 * Eintrag nach der Sperrfrist erneut zu; der Versuch bleibt gezählt (AGENTS.md: Versuch vorher
 * festschreiben, der Fehlerpfad löscht ihn nie).
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly job: IntervalJob;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly bookingMail: BookingMailHandler,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('BOOKING_JOBS_ENABLED', { infer: true });
    this.job = new IntervalJob('outbox', OUTBOX_INTERVAL_MS, () => this.runOnce(), this.logger);
  }

  onApplicationBootstrap(): void {
    if (this.enabled) {
      this.job.start();
    }
  }

  /**
   * Vor dem Schließen des HTTP-Servers und der Datenbank (onApplicationShutdown): Der Takt
   * steht, ein laufender Durchgang endet noch mit offener Verbindung.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.job.stop();
  }

  /** Ein Durchgang; Tests rufen ihn direkt auf. */
  async runOnce(): Promise<OutboxRunResult> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS);
    const claimed = await this.prisma.$queryRaw<ClaimedEntry[]>`
      UPDATE outbox o
      SET attempts = o.attempts + 1, next_attempt_at = ${leaseUntil}::timestamptz,
          updated_at = ${now}::timestamptz
      WHERE o.id IN (
        SELECT id FROM outbox
        WHERE status = 'PENDING' AND next_attempt_at <= ${now}::timestamptz
        ORDER BY next_attempt_at, id
        LIMIT ${OUTBOX_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING o.id, o.type, o.payload, o.attempts`;

    const result: OutboxRunResult = { done: 0, retried: 0, failed: 0 };
    for (const entry of claimed) {
      try {
        if (isBookingEvent(entry.type)) {
          await this.bookingMail.handle(entry.type, entry.payload as BookingEventPayload);
        }
        // Unbekannte Typen hat ein neuerer Code geschrieben oder niemand braucht sie: erledigt.
        await this.prisma.outbox.update({
          where: { id: entry.id },
          data: { status: 'DONE', processedAt: this.clock.now(), lastError: null },
        });
        result.done += 1;
      } catch (error) {
        const summary = errorSummary(error);
        const outcome = afterFailure(entry.attempts, this.clock.now());
        await this.prisma.outbox.update({
          where: { id: entry.id },
          data: {
            status: outcome.status,
            nextAttemptAt: outcome.nextAttemptAt,
            // Nur Klasse und Code: SMTP-Antworten nennen oft die Empfängeradresse.
            lastError:
              summary.code === undefined ? summary.type : `${summary.type}:${summary.code}`,
          },
        });
        this.logger.warn(
          { outboxId: entry.id, type: entry.type, attempts: entry.attempts, error: summary },
          outcome.status === 'FAILED'
            ? 'Outbox-Eintrag aufgegeben'
            : 'Outbox-Eintrag wird wiederholt',
        );
        if (outcome.status === 'FAILED') {
          result.failed += 1;
        } else {
          result.retried += 1;
        }
      }
    }
    return result;
  }
}
