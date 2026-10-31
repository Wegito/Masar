import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Clock } from '../../common/clock.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { cleanupAuthArtifacts } from '../auth/auth-cleanup.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { BookingsService } from '../bookings/bookings.service.js';

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<number>;
}

/**
 * Wiederkehrende Aufgaben im API-Prozess. Jede Aufgabe ist idempotent und sicher bei mehreren
 * Instanzen, weil sie unter denselben Sperren arbeitet wie die Anfragen. Fällt ein Lauf aus, holt
 * der nächste ihn nach; Holds laufen zusätzlich bei jeder neuen Buchung derselben Fahrt ab.
 *
 * Bewusst noch ohne pg-boss: Es braucht ein eigenes Schema mit DDL-Rechten, die die Anwendungsrolle
 * nicht hat. pg-boss folgt mit der Outbox-Zustellung (Phase 4).
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) {
      return;
    }
    const jobs: Job[] = [
      { name: 'booking-expiry', intervalMs: 60_000, run: () => this.bookings.expireDue() },
      {
        name: 'auth-cleanup',
        intervalMs: 3_600_000,
        run: () => cleanupAuthArtifacts(this.prisma, this.clock.now()),
      },
    ];
    for (const job of jobs) {
      const timer = setInterval(() => void this.runOnce(job), job.intervalMs);
      timer.unref();
      this.timers.push(timer);
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  }

  /** Ein Lauf je Aufgabe gleichzeitig; Fehler werden geloggt (ohne Personendaten), nicht geworfen. */
  private async runOnce(job: Job): Promise<void> {
    if (this.running.has(job.name)) {
      return;
    }
    this.running.add(job.name);
    try {
      const affected = await job.run();
      if (affected > 0) {
        this.logger.log({ job: job.name, affected }, 'Aufgabe ausgeführt');
      }
    } catch (error) {
      this.logger.error({ job: job.name, err: error }, 'Aufgabe fehlgeschlagen');
    } finally {
      this.running.delete(job.name);
    }
  }
}

@Module({ imports: [BookingsModule], providers: [JobScheduler] })
export class JobsModule {}
