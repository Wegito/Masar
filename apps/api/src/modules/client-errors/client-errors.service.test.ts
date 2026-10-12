import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClientErrorsService,
  GLOBAL_REPORTS_PER_MINUTE,
  scrubClientText,
} from './client-errors.service.js';

describe('scrubClientText', () => {
  it('lässt Stackframes von Skripten lesbar', () => {
    const frame = 'at f (https://masar.example/_next/static/chunks/3vh7dwog03ndj.js:1:2345)';
    expect(scrubClientText(frame)).toBe(frame);
  });

  it('entfernt Query und Fragment und bereinigt Seitenpfade', () => {
    expect(
      scrubClientText('at https://masar.example/ar/t/7KQ2M9XA?from=damascus#token=abc:12:5'),
    ).toBe('at https://masar.example/ar/t/:param');
    expect(scrubClientText('Failed to fetch https://masar.example/en/auth/login?next=x')).toBe(
      'Failed to fetch https://masar.example/en/auth/login',
    );
  });

  it('schwärzt lange Tokens und Telefonnummern', () => {
    const token = 'x9Y8'.repeat(11);
    expect(scrubClientText(`Token ${token} ungültig`)).toBe('Token [REDACTED] ungültig');
    expect(scrubClientText('Buchung für +963 933 123 456')).toBe('Buchung für [REDACTED]');
  });
});

describe('ClientErrorsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const report = {
    app: 'web',
    kind: 'error',
    message: 'Buchung für +963933123456',
    path: '/ar/t/7KQ2M9XA',
  } as const;

  it('loggt bereinigt und ohne leeres stack-Feld', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new ClientErrorsService({ now: () => new Date() });
    service.report(report);
    expect(warn).toHaveBeenCalledWith(
      {
        clientError: {
          app: 'web',
          kind: 'error',
          path: '/ar/t/:param',
          message: 'Buchung für [REDACTED]',
        },
      },
      'Fehler im Browser',
    );
  });

  it('loggt je Minute höchstens das globale Limit und meldet Verworfenes einmal', () => {
    let now = Date.parse('2026-10-12T10:00:00Z');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new ClientErrorsService({ now: () => new Date(now) });
    const lastArguments = (): unknown[] => warn.mock.calls.map((call): unknown => call.at(-1));

    for (let i = 0; i < GLOBAL_REPORTS_PER_MINUTE + 5; i += 1) {
      service.report(report);
    }
    expect(lastArguments().filter((text) => text === 'Fehler im Browser')).toHaveLength(
      GLOBAL_REPORTS_PER_MINUTE,
    );
    expect(
      lastArguments().filter((text) => String(text).startsWith('Globales Limit')),
    ).toHaveLength(1);

    warn.mockClear();
    now += 59_999;
    service.report(report);
    expect(warn).not.toHaveBeenCalled();

    now += 1;
    service.report(report);
    expect(warn.mock.calls[0]).toEqual([{ dropped: 6 }, expect.stringContaining('verworfen')]);
    expect(warn.mock.calls[1]?.at(-1)).toBe('Fehler im Browser');
  });
});
