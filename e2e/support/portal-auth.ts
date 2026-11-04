import { type Cookie, expect, type Page } from '@playwright/test';

/**
 * Anmeldung im Portal für Tests, deren Gegenstand nicht die Anmeldung selbst ist.
 *
 * Die API begrenzt `POST /auth/login` auf 10 Anfragen je Minute und IP (ADR 0009). Im
 * Gesamtlauf kommen alle Tests von derselben IP; meldete sich jeder Test über die Oberfläche an,
 * griffe die Grenze, und Tests scheiterten mit „Too many requests" (erster Gesamtlauf am
 * 2026-11-04: 36 von 38 grün). Deshalb meldet sich jedes Konto einmal je Worker über die
 * Oberfläche an; danach übernehmen weitere Tests das Sitzungs-Cookie. Ist die Sitzung inzwischen
 * ungültig (abgemeldet, abgelaufen), führt der Proxy zum Login, und der Helfer meldet neu an.
 * Die Anmeldung über die Oberfläche selbst prüfen `portal.spec.ts` und `bookings.portal.spec.ts`.
 */

export interface PortalAccount {
  email: string;
  password: string;
}

const LOGIN_TEXT = {
  ar: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
  en: { email: 'Email', password: 'Password', submit: 'Sign in' },
} as const;

/** Sitzungs-Cookies je Konto, nur im Speicher dieses Workers (nie auf der Platte). */
const sessions = new Map<string, Cookie[]>();

function onLoginPage(page: Page): boolean {
  return /\/auth\/login$/.test(new URL(page.url()).pathname);
}

/** Meldet `account` an und lässt die Seite auf der Startseite `/{locale}` stehen. */
export async function signIn(
  page: Page,
  locale: 'ar' | 'en',
  account: PortalAccount,
): Promise<void> {
  const cached = sessions.get(account.email);
  if (cached !== undefined) {
    await page.context().addCookies(cached);
    await page.goto(`/${locale}`);
    if (!onLoginPage(page)) {
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      return;
    }
    sessions.delete(account.email);
  }

  const text = LOGIN_TEXT[locale];
  await page.goto(`/${locale}/auth/login`);
  await page.getByLabel(text.email).fill(account.email);
  await page.getByLabel(text.password, { exact: true }).fill(account.password);
  await page.getByRole('button', { name: text.submit }).click();
  // Erst die Startseite abwarten, sonst bricht der nächste Seitenwechsel die Anmeldung ab.
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  const cookies = await page.context().cookies();
  sessions.set(
    account.email,
    cookies.filter((cookie) => cookie.name.endsWith('masar_session')),
  );
}
