import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';
import {
  deriveTicketToken,
  hashSecret,
  signAccessToken,
  verifyAccessToken,
} from './domain/secrets.js';

/**
 * Serverseitige Schlüssel für QR-Tokens und Lesetokens (ADR 0022). In Produktion verlangt die
 * Konfiguration beide (`TICKET_QR_KEY`, `BOOKING_ACCESS_KEY`). In Entwicklung und Tests ohne Angabe
 * entsteht je Prozess ein Zufallsschlüssel: Nach einem Neustart leitet die Ticketseite dann neue
 * QR-Codes ab und ersetzt den gespeicherten Hash. Kein fester Schlüssel steht im Code.
 */
@Injectable()
export class GuestKeys {
  private readonly logger = new Logger(GuestKeys.name);
  private readonly qrKey: Buffer;
  private readonly accessKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.qrKey = this.load(config.get('TICKET_QR_KEY', { infer: true }), 'TICKET_QR_KEY');
    this.accessKey = this.load(
      config.get('BOOKING_ACCESS_KEY', { infer: true }),
      'BOOKING_ACCESS_KEY',
    );
  }

  /** QR-Token eines Tickets; geht nur an Fahrgäste mit geprüftem Zugriff, nie ins Log. */
  ticketToken(ticketId: string, version: number): string {
    return deriveTicketToken(this.qrKey, ticketId, version);
  }

  /** SHA-256 des QR-Tokens; das steht in `ticket.qr_token_hash`. */
  ticketTokenHash(ticketId: string, version: number): string {
    return hashSecret(this.ticketToken(ticketId, version));
  }

  signAccess(bookingId: string, expiresAt: Date): string {
    return signAccessToken(this.accessKey, bookingId, expiresAt);
  }

  verifyAccess(bookingId: string, token: string, now: Date): boolean {
    return verifyAccessToken(this.accessKey, bookingId, token, now);
  }

  private load(value: string | undefined, name: string): Buffer {
    if (value !== undefined) {
      return Buffer.from(value, 'base64');
    }
    this.logger.warn(
      { variable: name },
      'Schlüssel fehlt, Zufallsschlüssel nur für diesen Prozess',
    );
    return randomBytes(32);
  }
}
