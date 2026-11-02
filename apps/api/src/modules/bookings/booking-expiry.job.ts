import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IntervalJob } from '../../common/interval-job.js';
import { errorSummary } from '../../common/logging.js';
import type { Env } from '../../config/env.js';
import { BookingsService } from './bookings.service.js';

const EXPIRY_INTERVAL_MS = 60_000;
/** Fahrten je Durchgang; der Rest folgt im nächsten. */
const EXPIRY_TRIPS_PER_RUN = 200;

export interface ExpiryRunResult {
  trips: number;
  expired: number;
}

/**
 * Minütlicher Ablauf (Domänenmodell, „Zustandsautomaten"): abgelaufene `HELD`, `RESERVED` und
 * `PENDING_CONFIRMATION` werden `EXPIRED`, ihre Belegungen gelöscht. Je Fahrt eine eigene
 * Transaktion unter der Trip-Sperre, genau wie beim Reservieren. Fällt der Job aus, gibt die nächste
 * Reservierung derselben Fahrt die Sitze trotzdem frei.
 */
@Injectable()
export class BookingExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BookingExpiryJob.name);
  private readonly job: IntervalJob;
  private readonly enabled: boolean;

  constructor(
    private readonly bookings: BookingsService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('BOOKING_JOBS_ENABLED', { infer: true });
    this.job = new IntervalJob(
      'booking-expiry',
      EXPIRY_INTERVAL_MS,
      () => this.runOnce(),
      this.logger,
    );
  }

  onApplicationBootstrap(): void {
    if (this.enabled) {
      this.job.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.job.stop();
  }

  /** Ein Durchgang; Tests rufen ihn direkt auf. */
  async runOnce(): Promise<ExpiryRunResult> {
    const tripIds = await this.bookings.tripsWithExpiredBookings(EXPIRY_TRIPS_PER_RUN);
    let expired = 0;
    for (const tripId of tripIds) {
      try {
        expired += await this.bookings.expireTrip(tripId);
      } catch (error) {
        // Eine Fahrt, die gerade nicht geht, hält die übrigen nicht auf.
        this.logger.warn(
          { tripId, error: errorSummary(error) },
          'Ablauf einer Fahrt fehlgeschlagen',
        );
      }
    }
    return { trips: tripIds.length, expired };
  }
}
