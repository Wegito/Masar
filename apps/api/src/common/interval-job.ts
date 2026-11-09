import type { Logger } from '@nestjs/common';

import { errorSummary } from './logging.js';

/**
 * Einfacher Taktgeber für Hintergrundjobs im API-Prozess (ADR 0021). Ein Lauf beginnt erst, wenn
 * der vorige fertig ist; ein Fehler beendet nur diesen Lauf, nicht den Takt. Korrektheit bei
 * mehreren Instanzen sichern die Jobs selbst über Datenbanksperren, nicht dieser Taktgeber.
 */
export class IntervalJob {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly run: () => Promise<unknown>,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Der Takt allein hält den Prozess nicht am Leben.
    this.timer.unref();
  }

  /** Hält den Takt an und wartet auf einen laufenden Durchgang. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private tick(): void {
    if (this.running !== undefined) {
      return;
    }
    this.running = this.run()
      .then(() => undefined)
      .catch((error: unknown) => {
        // Nur Fehlerklasse und Code: Meldungen der Datenbank können Werte aus Zeilen enthalten.
        this.logger.error({ job: this.name, error: errorSummary(error) }, 'Job fehlgeschlagen');
      })
      .finally(() => {
        this.running = undefined;
      });
  }
}
