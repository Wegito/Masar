import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { DatabaseHealthIndicator } from './database.health.js';

/**
 * Betriebs-Endpunkte ohne Versionspräfix: /api/health/live und /api/health/ready.
 * `live`: der Prozess antwortet. `ready`: alle Abhängigkeiten sind erreichbar.
 * Die Antworten nennen keine Infrastruktur-Details; Terminus loggt die Ursache bei einem Fehler,
 * und der globale Filter macht daraus 503 SERVICE_UNAVAILABLE.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    await this.health.check([() => this.database.check()]);
    return { status: 'ok' };
  }
}
