import { describe, expect, it } from 'vitest';

import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { logoutOutcome } from './logout';

describe('Abmelden', () => {
  it('leitet zum Login, wenn die API die Sitzung widerrufen hat', () => {
    expect(logoutOutcome({ ok: true, data: undefined })).toBe('redirect');
  });

  it('leitet auch bei 401 weiter: die Sitzung ist dann ohnehin ungültig', () => {
    expect(logoutOutcome({ ok: false, problem: { code: 'UNAUTHENTICATED', status: 401 } })).toBe(
      'redirect',
    );
  });

  it('bleibt bei Netzfehler, 429 und 5xx angemeldet und zeigt einen Fehler', () => {
    expect(logoutOutcome({ ok: false, problem: { code: 'NETWORK_ERROR', status: 0 } })).toBe(
      'error',
    );
    expect(
      logoutOutcome({
        ok: false,
        problem: { code: 'RATE_LIMITED', status: 429 },
        retryAfterSeconds: 30,
      }),
    ).toBe('error');
    expect(logoutOutcome({ ok: false, problem: { code: 'INTERNAL_ERROR', status: 503 } })).toBe(
      'error',
    );
  });

  it('hat einen Hinweistext in ar und en', () => {
    expect(ar.shell.logoutFailed).not.toBe('');
    expect(en.shell.logoutFailed).not.toBe('');
  });
});
