import { setImmediate } from 'node:timers/promises';

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { Clock } from '../../common/clock.js';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { MailMessage } from '../mail/mailer.js';
import { AuthService } from './auth.service.js';
import type { PasswordService } from './password.service.js';
import type { SessionService } from './session.service.js';

const KNOWN = 'agent@firma.example';
const UNKNOWN = 'niemand@firma.example';

/**
 * Datenbank, die jeden Aufruf protokolliert und erst antwortet, wenn das Tor geöffnet ist. So lässt
 * sich ohne Zeitmessung prüfen, welche Arbeit vor der Antwort an den Client geschieht.
 */
function gatedSetup() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const calls: string[] = [];
  const sent: MailMessage[] = [];
  const answer = <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    return gate.then(() => value);
  };
  const tx = {
    passwordReset: { create: () => answer('tx.passwordReset.create', {}) },
  };
  const prisma = {
    user: {
      findUnique: ({ where }: { where: { email: string } }) =>
        answer(
          'user.findUnique',
          where.email === KNOWN ? { id: 'u1', status: 'ACTIVE', preferredLocale: 'ar' } : null,
        ),
    },
    passwordReset: { count: () => answer('passwordReset.count', 0) },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      await answer('$transaction', undefined);
      return fn(tx);
    },
  };
  const audit = { record: () => answer('audit.record', undefined) };
  const mailer = {
    send: (message: MailMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  const config = { get: () => 'http://portal.example' };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as PasswordService,
    {} as SessionService,
    audit as unknown as AuditService,
    mailer,
    new Clock(),
    config as unknown as ConfigService<Env, true>,
  );
  return { service, calls, sent, open };
}

/** Ruft die Anfrage auf und meldet, ob sie zurückkam, solange die Datenbank noch nicht antwortet. */
async function respondsWhileDatabaseHangs(
  setup: ReturnType<typeof gatedSetup>,
  email: string,
): Promise<{ responded: boolean; callsBeforeResponse: string[] }> {
  let responded = false;
  let callsBeforeResponse: string[] = [];
  const result: unknown = setup.service.requestPasswordReset(email, {});
  void Promise.resolve(result).then(() => {
    responded = true;
    callsBeforeResponse = [...setup.calls];
  });
  await setImmediate();
  return { responded, callsBeforeResponse };
}

describe('Passwort-Reset ohne Zeitkanal', () => {
  it('antwortet für bekannte und unbekannte Adressen, ohne auf die Datenbank zu warten', async () => {
    const known = gatedSetup();
    const unknown = gatedSetup();

    const knownResult = await respondsWhileDatabaseHangs(known, KNOWN);
    const unknownResult = await respondsWhileDatabaseHangs(unknown, UNKNOWN);

    expect(knownResult.responded).toBe(true);
    expect(unknownResult).toEqual(knownResult);
  });

  it('erledigt Zählung, Schreiben und Versand danach, nur für bekannte Konten', async () => {
    const known = gatedSetup();
    const unknown = gatedSetup();
    known.service.requestPasswordReset(KNOWN, {});
    unknown.service.requestPasswordReset(UNKNOWN, {});
    known.open();
    unknown.open();
    await known.service.settled();
    await unknown.service.settled();

    expect(known.calls).toEqual([
      'user.findUnique',
      'passwordReset.count',
      '$transaction',
      'tx.passwordReset.create',
      'audit.record',
    ]);
    expect(known.sent.map((mail) => mail.to)).toEqual([KNOWN]);
    expect(unknown.calls).toEqual(['user.findUnique']);
    expect(unknown.sent).toEqual([]);
  });
});
