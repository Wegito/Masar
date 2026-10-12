import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Betriebs-Endpunkte ohne Versionspräfix: /api/health/live und /api/health/ready.
 * `live`: der Prozess antwortet. `ready`: alle Abhängigkeiten sind erreichbar (Datenbank ab
 * Schritt 0.6). Antworten enthalten keine Details über die Infrastruktur.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
