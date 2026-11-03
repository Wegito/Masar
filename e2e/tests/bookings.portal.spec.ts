import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { API_URL } from '../support/env';
import { ARABIC_INDIC_DIGIT, freeSeats, holdViaApi, seedDemo, seedTrip } from '../support/flow';

/**
 * Portal-Grundgerüst und Buchungen am Schalter (Schritte 2.1 und 2.5, Oberfläche): ohne Sitzung
 * zum Login, Anmeldung mit dem Seed-Konto, Startseite mit Firma und Kacheln, Navigation mit
 * „bald"-Einträgen, dann eine Barreservierung über den Code finden, bar bestätigen und stornieren.
 * Jede Sprache bucht eine eigene Abfahrt am Tag 5, damit sich die Tests keine Sitze teilen; das
 * Storno am Ende gibt die Sitze für den nächsten Lauf frei.
 */

// Dieselben Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};
const DAYS = 5;

const TEXT = {
  ar: {
    index: 1,
    login: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
    loginHeading: 'تسجيل الدخول',
    dashboard: 'لوحة التحكم',
    company: 'بولمان مسار التجريبي',
    nav: 'أقسام البوابة',
    links: ['الرئيسية', 'الأسطول', 'الحجوزات'],
    soon: ['الخطوط', 'الرحلات'],
    soonBadge: 'قريباً',
    bookings: 'الحجوزات',
    code: 'رمز الحجز',
    search: 'ابحث عن الحجز',
    invalid: 'رمز الحجز مكوّن من 8 أحرف وأرقام',
    notFound: 'لا يوجد حجز لشركتك بهذا الرمز.',
    reserved: 'محجوز، الدفع نقداً',
    confirmCash: 'تأكيد الدفع النقدي',
    confirmedNotice: 'تم تأكيد الدفع النقدي',
    confirmed: 'مؤكد',
    cancel: 'إلغاء الحجز',
    reason: 'سبب الإلغاء',
    cancelConfirm: 'ألغِ الحجز الآن',
    cancelled: 'ملغى',
    logout: 'تسجيل الخروج',
  },
  en: {
    index: 2,
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    loginHeading: 'Sign in',
    dashboard: 'Dashboard',
    company: 'Masar Demo Pullman',
    nav: 'Portal sections',
    links: ['Home', 'Fleet', 'Bookings'],
    soon: ['Routes', 'Trips'],
    soonBadge: 'soon',
    bookings: 'Bookings',
    code: 'Booking code',
    search: 'Find booking',
    invalid: 'A booking code has 8 letters and digits',
    notFound: 'No booking of your company has this code.',
    reserved: 'Reserved, pay in cash',
    confirmCash: 'Confirm cash payment',
    confirmedNotice: 'Cash payment confirmed',
    confirmed: 'Confirmed',
    cancel: 'Cancel booking',
    reason: 'Reason for cancellation',
    cancelConfirm: 'Cancel booking now',
    cancelled: 'Cancelled',
    logout: 'Sign out',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF);
});

/** Barreservierung an der Oberfläche vorbei (Hold, dann „bar zahlen"); liefert den Code. */
async function cashReservation(request: APIRequestContext, index: number): Promise<string> {
  const trip = await seedTrip(request, DAYS, index);
  const [seat] = await freeSeats(request, trip, 'MALE', 1);
  if (seat === undefined) throw new Error('Kein Sitz');
  const held = await holdViaApi(request, trip, seat, 'MALE');
  const reserved = await request.post(`${API_URL}/api/v1/bookings/${held.id}/reserve-cash`, {
    headers: { 'X-Manage-Token': held.manageToken },
  });
  expect(reserved.status()).toBe(200);
  const body = (await reserved.json()) as { status: string; bookingCode: string };
  expect(body.status).toBe('RESERVED');
  return body.bookingCode;
}

/** Fehlertext von ProblemMessage; Next hat einen eigenen, leeren Bereich mit role=alert. */
function alert(page: Page, text: string): ReturnType<Page['getByRole']> {
  return page.getByRole('alert').filter({ hasText: text });
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Portal (${locale}): anmelden, Start, Navigation, Buchung bar bestätigen und stornieren`, async ({
    page,
    request,
  }) => {
    const code = await cashReservation(request, text.index);

    // Ohne Sitzung leitet schon der Proxy zum Login derselben Sprache.
    await page.goto(`/${locale}/bookings`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await page.getByLabel(text.login.email).fill(STAFF.email);
    await page.getByLabel(text.login.password, { exact: true }).fill(STAFF.password);
    await page.getByRole('button', { name: text.login.submit }).click();

    // Startseite: Begrüßung, Firma in der Kopfzeile, Platzhalter-Kacheln.
    await expect(page.getByRole('heading', { name: text.dashboard })).toBeVisible();
    await expect(page.getByTestId('company-name')).toHaveText(text.company);
    await expect(page.locator('main article')).toHaveCount(4);

    // Navigation: vorhandene Ziele sind Links, Strecken und Fahrten tragen „bald".
    const nav = page.getByRole('navigation', { name: text.nav });
    for (const name of text.links) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }
    for (const name of text.soon) {
      await expect(nav.getByRole('link', { name })).toHaveCount(0);
      await expect(nav.getByText(name)).toHaveAttribute('aria-disabled', 'true');
      await expect(nav.getByText(name)).toContainText(text.soonBadge);
    }
    await nav.getByRole('link', { name: text.bookings }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/bookings$`));
    await expect(nav.getByRole('link', { name: text.bookings })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Falsche Form und unbekannter Code ergeben verständliche Meldungen.
    const input = page.getByLabel(text.code);
    await input.fill('ABC');
    await page.getByRole('button', { name: text.search }).click();
    await expect(alert(page, text.invalid)).toBeVisible();
    await input.fill(code === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ');
    await page.getByRole('button', { name: text.search }).click();
    await expect(alert(page, text.notFound)).toBeVisible();

    // Code klein und ohne Bindestrich, wie ihn jemand am Telefon diktiert.
    await input.fill(code.toLowerCase());
    await page.getByRole('button', { name: text.search }).click();
    const card = page.locator('article', { hasText: `${code.slice(0, 4)}-${code.slice(4)}` });
    await expect(card.getByText(text.reserved, { exact: true })).toBeVisible();
    await expect(card.getByText('Sami Khoury').first()).toBeVisible();
    expect(await card.innerText()).not.toMatch(ARABIC_INDIC_DIGIT);

    await card.getByRole('button', { name: text.confirmCash }).click();
    await expect(page.getByRole('status')).toContainText(text.confirmedNotice);
    await expect(card.getByText(text.confirmed, { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: text.confirmCash })).toHaveCount(0);

    // Storno in zwei Schritten: Grund wählen, dann bestätigen.
    await card.getByRole('button', { name: text.cancel }).click();
    await card.getByLabel(text.reason).selectOption('OTHER');
    await card.getByRole('button', { name: text.cancelConfirm }).click();
    await expect(card.getByText(text.cancelled, { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: text.cancel })).toHaveCount(0);

    // Der Code stand nie in der URL.
    expect(page.url()).not.toContain(code);

    await page.getByRole('button', { name: text.logout }).click();
    await expect(page.getByRole('heading', { name: text.loginHeading })).toBeVisible();
    await page.goto(`/${locale}`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
  });
}
