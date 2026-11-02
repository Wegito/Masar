import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/** Versuche je Buchungscode und Fenster, egal ob der Code existiert (ADR 0009, 0013, 0022). */
export const LOOKUP_ATTEMPTS_PER_CODE = 10;
export const LOOKUP_WINDOW_MS = 60 * 60_000;
/** Obergrenze der gemerkten Codes; darüber fällt der älteste Eintrag heraus. */
const MAX_TRACKED_CODES = 50_000;

interface Window {
  count: number;
  resetAt: number;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Begrenzt die Suche nach Code und Telefon je Buchungscode, zusätzlich zur Grenze je IP. Wer einen
 * Code kennt (etwa von einem Foto des Tickets), soll die Telefonnummer nicht über viele IPs
 * durchprobieren können. Gezählt wird jeder Versuch, auch für unbekannte Codes; die Antwort verrät
 * so nicht, ob es den Code gibt.
 *
 * Gemerkt wird nur der SHA-256 des normalisierten Codes, nicht der Code selbst. Der Speicher liegt
 * im Prozess (eine API-Instanz, ADR 0009); ein Neustart setzt die Zähler zurück.
 */
@Injectable()
export class LookupLimiter {
  private readonly windows = new Map<string, Window>();

  hit(bookingCode: string, nowMs: number): LimitDecision {
    const key = createHash('sha256').update(bookingCode, 'utf8').digest('base64url');
    let window = this.windows.get(key);
    if (window === undefined || window.resetAt <= nowMs) {
      this.windows.delete(key);
      this.evict(nowMs);
      window = { count: 0, resetAt: nowMs + LOOKUP_WINDOW_MS };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > LOOKUP_ATTEMPTS_PER_CODE) {
      return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - nowMs) / 1000) };
    }
    return { allowed: true };
  }

  /** Nur für Tests: Alle Tests laufen mit denselben Codes nacheinander. */
  reset(): void {
    this.windows.clear();
  }

  private evict(nowMs: number): void {
    if (this.windows.size < MAX_TRACKED_CODES) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.resetAt <= nowMs) {
        this.windows.delete(key);
      }
    }
    // Map hält die Einfügereihenfolge: Der erste Eintrag ist der älteste.
    while (this.windows.size >= MAX_TRACKED_CODES) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.windows.delete(oldest);
    }
  }
}
