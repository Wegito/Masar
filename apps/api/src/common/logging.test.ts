import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { redactPaths, serializeError } from './logging.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ redact: { paths: redactPaths(), censor: '[REDACTED]' } }, stream);
  return { logger, output: () => lines.join('') };
}

describe('Schwärzung im Log', () => {
  it('entfernt personenbezogene Werte auf oberster Ebene und bis zu zwei Ebenen tief', () => {
    const { logger, output } = captureLogger();
    logger.info({
      phone: '+963933123456',
      booking: { contactPhoneE164: '+963944000111', contactName: 'Rania' },
      passengers: { first: { nationalId: '01234567890', gender: 'FEMALE' } },
      password: 'hunter2-geheim',
      bookingCode: 'ABCD2345',
    });
    const text = output();
    for (const secret of [
      '933123456',
      '944000111',
      'Rania',
      '01234567890',
      'FEMALE',
      'hunter2',
      'ABCD2345',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[REDACTED]');
  });

  it('lässt technische Felder lesbar', () => {
    const { logger, output } = captureLogger();
    logger.info({ bookingId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12', status: 'HELD' });
    expect(output()).toContain('0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12');
  });
});

describe('Fehler im Log', () => {
  it('maskiert Telefon- und Ausweisnummern in Meldung und Stacktrace', () => {
    const serialized = serializeError(
      new Error('Konflikt für +963933123456 und 0933 123 456, Ausweis 01234567890'),
    );
    const text = JSON.stringify(serialized);
    for (const secret of ['933123456', '0933 123 456', '01234567890']) {
      expect(text).not.toContain(secret);
    }
    expect(serialized['message']).toContain('[REDACTED]');
  });

  it('behält kurze Zahlen, technische Codes und den Fehlertyp', () => {
    const error = Object.assign(new TypeError('Status 409 nach 3 Versuchen'), { code: '23P01' });
    expect(serializeError(error)).toMatchObject({
      type: 'TypeError',
      message: 'Status 409 nach 3 Versuchen',
      code: '23P01',
    });
  });

  it('übernimmt keine weiteren Eigenschaften, die Eingabewerte tragen könnten', () => {
    const error = Object.assign(new Error('x'), { meta: { phone: '+963933123456' } });
    expect(serializeError(error)).not.toHaveProperty('meta');
  });
});
