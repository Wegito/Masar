import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { errorSummary, redactPaths, serializeError } from './logging.js';

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

  it('maskiert E-Mail-Adressen in Meldung und Stacktrace (z. B. aus SMTP-Antworten)', () => {
    const error = new Error(
      "Can't send mail - all recipients were rejected: 550 5.1.1 <Agent.Lina+test@firma-a.example>: Recipient address rejected; cc lina@xn--mgbh0fb.example",
    );
    const text = JSON.stringify(serializeError(error));
    for (const secret of ['Agent.Lina+test', 'firma-a.example', 'lina@', 'xn--mgbh0fb']) {
      expect(text).not.toContain(secret);
    }
    expect(serializeError(error)['message']).toContain('550 5.1.1 <[REDACTED]>');
  });
});

describe('Kurzform für Fehler externer Dienste', () => {
  it('enthält nur Fehlerklasse und Code, keine Meldung', () => {
    const error = Object.assign(new Error('550 <agent@firma.example> rejected'), {
      code: 'EENVELOPE',
      response: '550 <agent@firma.example>',
    });
    expect(errorSummary(error)).toEqual({ type: 'Error', code: 'EENVELOPE' });
    expect(JSON.stringify(errorSummary(error))).not.toContain('agent@');
  });

  it('kommt mit Werten aus, die keine Fehler sind', () => {
    expect(errorSummary('agent@firma.example')).toEqual({ type: 'string' });
    expect(errorSummary(Object.assign(new TypeError('x'), { code: 'x'.repeat(41) }))).toEqual({
      type: 'TypeError',
    });
  });
});
