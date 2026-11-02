import { execSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { API_DIR, API_URL, TEST_DATABASE_URL } from '../support/env';

/**
 * Ticketseite und „Meine Buchung" (Schritt 1.4, ADR 0022) gegen die echte API. Die Buchungen
 * entstehen über die API aus 1.3 (Hold, Barreservierung, Barbestätigung durch das Demo-Konto des
 * Seeds); den Buchungsablauf in der Web-App baut Schritt 1.5. Gebucht wird die letzte Fahrt in
 * drei Tagen, nicht die Fahrten von morgen, die der Ablauf-Test mit freien Sitzen erwartet; am
 * Ende storniert die Firma alle Buchungen, damit die Sitze für den nächsten Lauf frei sind.
 */

const STAFF_EMAIL = 'e2e-ticket-agent@masar.invalid';
const STAFF_PASSWORD = 'e2e-passwort-ticket-2026'; // gitleaks:allow (Testwert)
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

const created: { id: string; companyId: string }[] = [];

test.beforeAll(() => {
  // Demo-Fahrten und ein Konto mit Admin-Rolle in der Demo-Firma; idempotent.
  execSync('pnpm run db:seed', {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      SEED_STAFF_EMAIL: STAFF_EMAIL,
      SEED_STAFF_PASSWORD: STAFF_PASSWORD,
    },
    stdio: 'pipe',
  });
});

test.afterAll(async ({ request }) => {
  const cookie = await staffCookie(request);
  for (const booking of created) {
    await request.post(
      `${API_URL}/api/v1/companies/${booking.companyId}/bookings/${booking.id}/cancel`,
      { headers: { Cookie: cookie }, data: { reason: 'OTHER' } },
    );
  }
});

async function staffCookie(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
  });
  expect(login.status()).toBe(200);
  const cookie = /__Host-masar_session=[^;]+/.exec(login.headers()['set-cookie'] ?? '')?.[0];
  if (cookie === undefined) throw new Error('Kein Sitzungs-Cookie');
  return cookie;
}

interface Booking {
  id: string;
  bookingCode: string;
  manageToken: string;
  phone: string;
  companyId: string;
  departureAt: string;
  seats: string[];
}

/** Jede Buchung eine eigene Nummer, damit das Limit offener Buchungen je Telefon nicht greift. */
function randomPhone(): { e164: string; local: string } {
  const rest = String(randomInt(1_000_000, 9_999_999));
  return { e164: `+96393${rest}`, local: `093 ${rest.slice(0, 3)} ${rest.slice(3)}` };
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.url()}: ${String(response.status())} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** In drei Tagen in Damaskus als Kalendertag (das Seed legt sieben Tage an). */
function inThreeDays(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(
    new Date(Date.now() + 3 * 24 * 3_600_000),
  );
}

/** Uhrzeit in Damaskus, 24 Stunden, wie die Oberfläche sie zeigen muss. */
function damascusTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Damascus',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Zwei Frauen von Damaskus nach Aleppo in drei Tagen; bar reserviert, auf Wunsch bestätigt. */
async function createBooking(
  request: APIRequestContext,
  options: { confirm: boolean },
): Promise<Booking> {
  const cities = await json<{ items: { id: string; nameEn: string }[] }>(
    await request.get(`${API_URL}/api/v1/cities`),
  );
  const cityId = (name: string): string => {
    const city = cities.items.find((entry) => entry.nameEn === name);
    if (city === undefined) throw new Error(`Stadt ${name} fehlt im Seed`);
    return city.id;
  };
  const search = await json<{
    items: {
      tripId: string;
      company: { id: string };
      departureAt: string;
      from: { tripStopId: string };
      to: { tripStopId: string };
    }[];
  }>(
    await request.get(`${API_URL}/api/v1/trips/search`, {
      params: { from: cityId('Damascus'), to: cityId('Aleppo'), date: inThreeDays() },
    }),
  );
  const trip = search.items.at(-1);
  if (trip === undefined) throw new Error('Keine Fahrt im Seed');
  const seatMap = await json<{ seats: { seatId: string; label: string; state: string }[] }>(
    await request.get(`${API_URL}/api/v1/trips/${trip.tripId}/seat-map`, {
      params: { fromStopId: trip.from.tripStopId, toStopId: trip.to.tripStopId, gender: 'FEMALE' },
    }),
  );
  const free = seatMap.seats.filter((seat) => seat.state === 'FREE').slice(0, 2);
  if (free.length < 2) throw new Error('Zu wenige freie Sitze; Testdatenbank neu aufsetzen');
  const phone = randomPhone();
  const held = await json<{ booking: { id: string; bookingCode: string }; manageToken: string }>(
    await request.post(`${API_URL}/api/v1/bookings`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        tripId: trip.tripId,
        fromStopId: trip.from.tripStopId,
        toStopId: trip.to.tripStopId,
        locale: 'ar',
        contact: { name: 'Lina Haddad', phone: phone.e164 },
        passengers: free.map((seat, index) => ({
          seatId: seat.seatId,
          fullName: index === 0 ? 'Lina Haddad' : 'Rana Haddad',
          gender: 'FEMALE',
        })),
      },
    }),
  );
  const manageToken = held.manageToken;
  created.push({ id: held.booking.id, companyId: trip.company.id });
  await json(
    await request.post(`${API_URL}/api/v1/bookings/${held.booking.id}/reserve-cash`, {
      headers: { 'X-Manage-Token': manageToken },
    }),
  );
  if (options.confirm) {
    const cookie = await staffCookie(request);
    await json(
      await request.post(
        `${API_URL}/api/v1/companies/${trip.company.id}/bookings/${held.booking.id}/confirm-cash`,
        { headers: { Cookie: cookie } },
      ),
    );
  }
  return {
    id: held.booking.id,
    bookingCode: held.booking.bookingCode,
    manageToken,
    phone: phone.local,
    companyId: trip.company.id,
    departureAt: trip.departureAt,
    seats: free.map((seat) => seat.label),
  };
}

/** Sammelt alle URLs, die der Browser anfragt: Token, Code und Telefon dürfen in keiner stehen. */
function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

test.describe('arabisch', () => {
  test.use({ locale: 'ar-SY' });

  test('öffnet das Ticket über Code und Telefon, zeigt QR-Codes und bleibt offline lesbar', async ({
    page,
    context,
    request,
  }) => {
    const booking = await createBooking(request, { confirm: true });
    const urls = watchUrls(page);

    await page.goto('/ar');
    await page.getByRole('link', { name: 'حجزي' }).click();
    await expect(page).toHaveURL(/\/ar\/my-booking$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('حجزي');
    // Code klein und mit Bindestrich, Telefon in lokaler Schreibweise: beides normalisiert die API.
    await page.getByLabel('رمز الحجز').fill(formatCode(booking.bookingCode).toLowerCase());
    await page.getByLabel('رقم الهاتف').fill(booking.phone);
    await page.getByRole('button', { name: 'عرض حجزي' }).click();

    await expect(page).toHaveURL(new RegExp(`/ar/bookings/${booking.id}#token=[A-Za-z0-9_-]{32}$`));
    const url = new URL(page.url());
    expect(url.search).toBe('');
    const token = new URLSearchParams(url.hash.slice(1)).get('token') ?? '';

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تذكرتك');
    await expect(page.getByText('مؤكد', { exact: true })).toBeVisible();
    await expect(page.getByText(formatCode(booking.bookingCode), { exact: true })).toBeVisible();
    await expect(page.getByText('حجزك مؤكد.', { exact: false })).toBeVisible();
    const qrCodes = page.getByRole('img', { name: /^رمز الاستجابة السريعة للمقعد / });
    await expect(qrCodes).toHaveCount(2);
    for (const label of booking.seats) {
      const qr = page.getByRole('img', { name: `رمز الاستجابة السريعة للمقعد ${label}` });
      await expect(qr).toBeVisible();
      await expect(qr.locator('path')).toHaveAttribute('d', /^M\d+ \d+h/);
    }
    await expect(page.getByText('Lina Haddad')).toBeVisible();
    await expect(page.getByText(damascusTime(booking.departureAt)).first()).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(ARABIC_INDIC_DIGIT);

    // Kein Token, kein Code, kein Telefon in einer angefragten URL (nur im Fragment der Seite).
    const digits = booking.phone.replace(/\D/g, '').slice(1);
    for (const requested of urls) {
      expect(requested).not.toContain(token);
      expect(requested).not.toContain(booking.manageToken);
      expect(requested.toUpperCase()).not.toContain(booking.bookingCode);
      expect(requested).not.toContain(digits);
      expect(requested).not.toContain('#');
    }

    // Offline: Die Seite kommt aus dem Service Worker, die Daten aus der gespeicherten Kopie.
    await expect(page.locator('[data-offline-ready="true"]')).toBeAttached();
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByText(/^أنت غير متصل بالإنترنت\./)).toBeVisible();
      await expect(qrCodes).toHaveCount(2);
      await expect(page.getByText(formatCode(booking.bookingCode), { exact: true })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }

    // Sprachwechsel behält das Token im Fragment.
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/bookings/${booking.id}#token=${token}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your ticket');
    await expect(page.getByRole('img', { name: /^QR code for seat / })).toHaveCount(2);
  });

  test('gibt für ein falsches Telefon denselben Hinweis wie für einen unbekannten Code', async ({
    page,
    request,
  }) => {
    const booking = await createBooking(request, { confirm: false });
    await page.goto('/ar/my-booking');
    await page.getByLabel('رمز الحجز').fill(booking.bookingCode);
    await page.getByLabel('رقم الهاتف').fill('0999 000 111');
    await page.getByRole('button', { name: 'عرض حجزي' }).click();
    const notFound = page
      .getByRole('alert')
      .filter({ hasText: 'لم نجد حجزاً بهذا الرمز ورقم الهاتف.' });
    await expect(notFound).toBeVisible();
    // Eingaben bleiben stehen, damit ein Tippfehler schnell korrigiert ist.
    await expect(page.getByLabel('رقم الهاتف')).toHaveValue('0999 000 111');

    await page.getByLabel('رمز الحجز').fill('ZZZZ-ZZZZ');
    await page.getByLabel('رقم الهاتف').fill(booking.phone);
    await page.getByRole('button', { name: 'عرض حجزي' }).click();
    await expect(notFound).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('englisch', () => {
  test.use({ locale: 'en-US' });

  test('zeigt das bestätigte Ticket über das Verwaltungstoken und druckt ohne Kopfzeile', async ({
    page,
    request,
  }) => {
    const booking = await createBooking(request, { confirm: true });
    await page.goto(`/en/bookings/${booking.id}#token=${booking.manageToken}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your ticket');
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /^QR code for seat / })).toHaveCount(2);
    await expect(page.getByText('Rana Haddad')).toBeVisible();
    await expect(page.getByText(damascusTime(booking.departureAt)).first()).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('link', { name: 'My booking' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print ticket' })).toBeHidden();
    await expect(page.getByRole('img', { name: /^QR code for seat / }).first()).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    // Von diesem Gerät entfernen: Danach zeigt die Seite ohne Netz keine Kopie mehr.
    await page.getByRole('button', { name: 'Remove from this device' }).click();
    await expect(page.getByText('The ticket has been removed from this device.')).toBeVisible();
    const stored = await page.evaluate(
      (id) => window.localStorage.getItem(`masar.ticket.${id}`),
      booking.id,
    );
    expect(stored).toBeNull();
  });

  test('erklärt eine Barreservierung mit Frist und zeigt noch keinen QR-Code', async ({
    page,
    request,
  }) => {
    const booking = await createBooking(request, { confirm: false });
    await page.goto(`/en/bookings/${booking.id}#token=${booking.manageToken}`);
    await expect(page.getByText('Reserved, pay in cash', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/^Reserved for cash payment\. Pay .+ before \d{2}:\d{2} on /),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /^QR code for seat / })).toHaveCount(0);
    await expect(
      page.getByText('The ticket with QR code appears once the payment is confirmed.'),
    ).toHaveCount(2);
  });

  test('ohne Token im Fragment verweist die Seite auf Code und Telefon', async ({ page }) => {
    await page.goto(`/en/bookings/${randomUUID()}`);
    const alert = page.getByRole('alert').filter({ hasText: 'This link is incomplete.' });
    await expect(alert).toBeVisible();
    await alert.getByRole('link', { name: 'Open with booking code' }).click();
    await expect(page).toHaveURL(/\/en\/my-booking$/);
  });
});
