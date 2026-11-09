import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';

/**
 * Versuche je Buchungscode und Client in einem Fenster, egal ob der Code existiert (ADR 0022,
 * ADR 0033). Ein Client ist eine IPv4-Adresse oder ein IPv6-Präfix (`LOOKUP_IPV6_PREFIX`).
 */
export const LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT = 10;
/**
 * Versuche je Buchungscode über alle Clients. Jeder Client trägt höchstens
 * `LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT` dazu bei; wer einen fremden Code für alle sperren will,
 * braucht also mindestens zehn Clients.
 */
export const LOOKUP_ATTEMPTS_PER_CODE = 100;
export const LOOKUP_WINDOW_MS = 60 * 60_000;
/**
 * IPv6 zählt je /48: Ein Anschluss bekommt oft ein ganzes /56 oder /48 und könnte sonst beliebig
 * viele Clients spielen. Der Schlüssel enthält den Code, also teilen sich Nachbarn im selben
 * Präfix die Grenze nur für denselben Code.
 */
export const LOOKUP_IPV6_PREFIX = 48;
/** Obergrenze der gemerkten Schlüssel; darüber fällt der älteste Eintrag heraus. */
const MAX_TRACKED_KEYS = 100_000;

interface Window {
  count: number;
  resetAt: number;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Begrenzt die Suche nach Code und Telefon je Buchungscode, zusätzlich zur Grenze je IP im
 * Controller. Zwei Zähler:
 *
 * - je Code und Client (10 je Stunde): bremst das Durchprobieren der Telefonnummer und sperrt nur
 *   den Client, der probiert, nicht den echten Fahrgast;
 * - je Code über alle Clients (100 je Stunde): bremst das Durchprobieren über viele IPs.
 *
 * Ein Versuch, den schon die erste Grenze ablehnt, zählt nicht für die zweite. Gezählt wird jeder
 * Versuch, auch für unbekannte Codes; die Antwort verrät so nicht, ob es den Code gibt.
 *
 * Gemerkt wird nur ein SHA-256 aus Code und Client, nie Code oder IP selbst. Der Speicher liegt im
 * Prozess (eine API-Instanz, ADR 0021): Ein Neustart setzt die Zähler zurück, und mehrere Instanzen
 * vervielfachen die Grenzen (ADR 0033).
 */
@Injectable()
export class LookupLimiter {
  private readonly windows = new Map<string, Window>();

  /** `clientIp` ist `req.ip`; ohne IP zählen alle solchen Anfragen als ein Client. */
  hit(bookingCode: string, clientIp: string | undefined, nowMs: number): LimitDecision {
    const client = clientIp === undefined ? 'unknown' : normalizeIp(clientIp, LOOKUP_IPV6_PREFIX);
    const perClient = this.count(
      key('client', `${bookingCode}\u0000${client}`),
      LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT,
      nowMs,
    );
    if (!perClient.allowed) {
      return perClient;
    }
    return this.count(key('code', bookingCode), LOOKUP_ATTEMPTS_PER_CODE, nowMs);
  }

  /** Nur für Tests: Alle Tests laufen mit denselben Codes nacheinander. */
  reset(): void {
    this.windows.clear();
  }

  private count(id: string, limit: number, nowMs: number): LimitDecision {
    let window = this.windows.get(id);
    if (window === undefined || window.resetAt <= nowMs) {
      this.windows.delete(id);
      this.evict(nowMs);
      window = { count: 0, resetAt: nowMs + LOOKUP_WINDOW_MS };
      this.windows.set(id, window);
    }
    window.count += 1;
    if (window.count > limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - nowMs) / 1000) };
    }
    return { allowed: true };
  }

  private evict(nowMs: number): void {
    if (this.windows.size < MAX_TRACKED_KEYS) {
      return;
    }
    for (const [id, window] of this.windows) {
      if (window.resetAt <= nowMs) {
        this.windows.delete(id);
      }
    }
    // Map hält die Einfügereihenfolge: Der erste Eintrag ist der älteste.
    while (this.windows.size >= MAX_TRACKED_KEYS) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.windows.delete(oldest);
    }
  }
}

function key(kind: 'client' | 'code', value: string): string {
  return `${kind}:${createHash('sha256').update(value, 'utf8').digest('base64url')}`;
}
