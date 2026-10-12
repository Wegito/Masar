import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Datenbankzugriff der Anwendung mit der Anwendungsrolle (nur Daten, kein DDL; ADR 0004).
 *
 * Die Verbindung entsteht beim ersten Zugriff. Ist die Datenbank beim Start nicht erreichbar,
 * startet die API trotzdem und meldet sich über /api/health/ready als nicht bereit.
 *
 * Die Timeouts folgen aus dem Sperrkonzept (ADR 0005): Eine Buchung sperrt die Fahrt-Zeile.
 * Hängt eine Transaktion, dürfen andere Buchungen derselben Fahrt nicht unbegrenzt warten.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        application_name: 'masar-api',
        max: 10,
        // pg wartet ohne Angabe unbegrenzt auf eine freie Verbindung.
        connectionTimeoutMillis: 5_000,
        // Warten auf eine Sperre (z. B. Fahrt-Zeile) bricht nach 5 s ab statt Anfragen zu stauen.
        lock_timeout: 5_000,
        // Eine Abfrage darf höchstens 10 s laufen.
        statement_timeout: 10_000,
        // Eine offene, aber untätige Transaktion gibt ihre Sperren nach 10 s frei.
        idle_in_transaction_session_timeout: 10_000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
