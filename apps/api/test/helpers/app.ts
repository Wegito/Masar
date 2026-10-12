import type { Writable } from 'node:stream';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { Clock } from '../../src/common/clock.js';
import { pinoHttpOptions } from '../../src/common/logging.js';
import { type CompanyRole, PrismaClient } from '../../src/generated/prisma/client.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { type MailMessage, Mailer } from '../../src/modules/mail/mailer.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TEST_MIGRATE_DATABASE_URL } from '../global-setup.js';

// Testwerte, keine Geheimnisse. Sie stehen nur hier, damit der Geheimnis-Scan sie einmal
// ausdrücklich freigegeben sieht statt in jeder Testdatei.
export const PASSWORD = 'richtig-langes-passwort-2026'; // gitleaks:allow
export const NEW_PASSWORD = 'ganz-neues-passwort-2026'; // gitleaks:allow
export const ANOTHER_PASSWORD = 'noch-ein-passwort-2026'; // gitleaks:allow
export const FOREIGN_PASSWORD = 'uebernahme-versuch-2026'; // gitleaks:allow

/** Fängt E-Mails ab, statt sie zu senden. */
export class FakeMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Token aus dem letzten Link an diese Adresse (steht nach `#token=`). */
  tokenSentTo(email: string): string {
    const message = this.sent.findLast((entry) => entry.to === email);
    const token = message?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (token === undefined) {
      throw new Error(`Keine Mail mit Token an ${email}`);
    }
    return token;
  }
}

/** Steuerbare Uhr; beginnt bei der echten Zeit, damit Datenbank-Standardwerte nah dran liegen. */
export class FakeClock extends Clock {
  private current = new Date();

  override now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/**
 * Ratenbegrenzung mit Zurücksetzen über eine frische Instanz. Nur die sichtbare Map zu leeren
 * reicht nicht: Der Throttler hält die Zeitstempel der Treffer in einer zweiten, privaten Map
 * und rechnet daraus die Zählung zurück.
 */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private inner = new ThrottlerStorageService();

  increment(
    ...args: Parameters<ThrottlerStorage['increment']>
  ): ReturnType<ThrottlerStorage['increment']> {
    return this.inner.increment(...args);
  }

  reset(): void {
    this.inner.onApplicationShutdown();
    this.inner = new ThrottlerStorageService();
  }
}

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  mailer: FakeMailer;
  clock: FakeClock;
  http: () => ReturnType<typeof request>;
  /** Alle Tests laufen von derselben IP; ohne Zurücksetzen griffe die Ratenbegrenzung testübergreifend. */
  resetRateLimits: () => void;
}

export interface TestAppOptions {
  /** Leitet die echte Log-Ausgabe (JSON, ab Stufe info) in diesen Strom um. */
  logs?: Writable;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const mailer = new FakeMailer();
  const clock = new FakeClock();
  const throttlerStorage = new ResettableThrottlerStorage();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(ThrottlerStorage)
    .useValue(throttlerStorage);
  if (options.logs !== undefined) {
    builder = builder.overrideProvider(PARAMS_PROVIDER_TOKEN).useValue({
      pinoHttp: [pinoHttpOptions({ LOG_LEVEL: 'info', LOG_FORMAT: 'json' }), options.logs],
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    mailer,
    clock,
    http: () => request(app.getHttpServer()),
    resetRateLimits: () => throttlerStorage.reset(),
  };
}

/** Leert alle Tabellen der Anmeldung. TRUNCATE darf nur die Migrationsrolle. */
export async function resetDatabase(): Promise<void> {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_MIGRATE_DATABASE_URL }),
  });
  try {
    await client.$executeRawUnsafe(
      'TRUNCATE "audit_log", "session", "password_reset", "invitation", "company_member", "company", "user" CASCADE',
    );
  } finally {
    await client.$disconnect();
  }
}

const passwords = new PasswordService();

export async function createStaff(
  prisma: PrismaService,
  input: {
    email: string;
    password?: string;
    isPlatformAdmin?: boolean;
    status?: 'ACTIVE' | 'DISABLED';
    memberships?: { companyId: string; role: CompanyRole }[];
  },
): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      email: input.email,
      displayName: 'Testperson',
      passwordHash: input.password === undefined ? null : await passwords.hash(input.password),
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      status: input.status ?? 'ACTIVE',
      memberships: { create: input.memberships ?? [] },
    },
    select: { id: true },
  });
}

export async function createCompany(prisma: PrismaService, slug: string): Promise<{ id: string }> {
  return prisma.company.create({
    data: { slug, nameAr: `شركة ${slug}`, nameEn: `Company ${slug}` },
    select: { id: true },
  });
}

/** Wert des Sitzungs-Cookies aus einer Antwort, als `Cookie`-Header für weitere Anfragen. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((entry) => entry.startsWith('__Host-masar_session='));
  if (cookie === undefined) {
    throw new Error('Kein Sitzungs-Cookie in der Antwort');
  }
  return cookie.split(';')[0] ?? '';
}

export async function loginAs(
  testApp: TestApp,
  email: string,
  password = PASSWORD,
): Promise<string> {
  const res = await testApp.http().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login fehlgeschlagen: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return sessionCookie(res);
}
