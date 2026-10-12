import { sanitizePath } from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';

import { Clock } from '../../common/clock.js';
import { scrubDigits } from '../../common/logging.js';
import type { ClientErrorInput } from './client-errors.schemas.js';

/**
 * Obergrenze über alle Absender je Minute. Die Drosselung je IP allein hilft nicht, wenn viele
 * IPs melden; ohne diese Grenze könnte jemand Logs und Platte füllen. 120 Meldungen je Minute
 * reichen, um auch einen Fehler zu erkennen, der alle Nutzer trifft.
 */
export const GLOBAL_REPORTS_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

/** URL in Meldung oder Stacktrace: Ursprung, Pfad, dann optional Query und Fragment. */
const URL_IN_TEXT = /(https?:\/\/[^\s/?#)"'`]+)([^\s?#)"'`]*)(?:[?#][^\s)"'`]*)?/g;
/** Lange Zeichenketten wie Sitzungs-, Reset- oder Einladungs-Tokens (32 Bytes ergeben 43 Zeichen). */
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;

/**
 * Query und Fragment fallen immer weg (Suchparameter, `#token=`). Skripte unter `/_next/` behalten
 * ihren Pfad, damit Stackframes lesbar bleiben; andere Pfade sind Seiten-URLs und werden wie der
 * gemeldete Pfad bereinigt (z. B. Buchungscode in `/ar/t/<code>`).
 */
function scrubUrl(_match: string, origin: string, path: string): string {
  return origin + (path.startsWith('/_next/') ? path : sanitizePath(path));
}

/** Bereinigt Meldung und Stacktrace aus dem Browser; der Client gilt nicht als vertrauenswürdig. */
export function scrubClientText(text: string): string {
  return scrubDigits(text.replace(URL_IN_TEXT, scrubUrl).replace(LONG_TOKEN, '[REDACTED]'));
}

/**
 * Schreibt Fehler aus Web und Portal ins Log (Stufe warn: Fehler im Browser sind kein Ausfall der
 * API). Bewusst ohne Person, Sitzung und IP. Die Grenze gilt je API-Instanz, wie der Throttler.
 */
@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger('ClientErrors');
  private windowStartedAt = Number.NEGATIVE_INFINITY;
  private logged = 0;
  private dropped = 0;

  constructor(private readonly clock: Clock) {}

  report(input: ClientErrorInput): void {
    const now = this.clock.now().getTime();
    if (now - this.windowStartedAt >= WINDOW_MS) {
      if (this.dropped > 0) {
        this.logger.warn(
          { dropped: this.dropped },
          'Browser-Fehler der letzten Minute wegen des globalen Limits verworfen',
        );
      }
      this.windowStartedAt = now;
      this.logged = 0;
      this.dropped = 0;
    }
    if (this.logged >= GLOBAL_REPORTS_PER_MINUTE) {
      this.dropped += 1;
      if (this.dropped === 1) {
        this.logger.warn(
          'Globales Limit für Browser-Fehler erreicht; weitere Meldungen dieser Minute werden verworfen',
        );
      }
      return;
    }
    this.logged += 1;
    this.logger.warn(
      {
        clientError: {
          app: input.app,
          kind: input.kind,
          path: sanitizePath(input.path),
          message: scrubClientText(input.message),
          ...(input.stack === undefined ? {} : { stack: scrubClientText(input.stack) }),
        },
      },
      'Fehler im Browser',
    );
  }
}
