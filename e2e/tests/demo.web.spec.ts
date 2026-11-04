import { type APIRequestContext, expect, test } from '@playwright/test';

import { API_URL } from '../support/env';
import {
  ARABIC_INDIC_DIGIT,
  fillPassengerDetails,
  freeSeats,
  randomPhone,
  searchAndOpenTrip,
  seedDemo,
  seedTrip,
} from '../support/flow';

/**
 * Demo-Ablauf aus docs/demo.md (Schritt 1.6): Ein Fahrgast bucht in der Web-App bis zur
 * Barreservierung, das Personal der Demo-Firma bestätigt die Barzahlung über die API (Anmeldung,
 * eigene Firma aus `/auth/me`, Buchung über den Code, `confirm-cash`), danach zeigt die
 * Ticketseite die bestätigte Buchung mit QR-Code. Gebucht wird in vier Tagen, damit sich der Test
 * nicht mit den anderen Abläufen die Sitze teilt; am Ende storniert die Firma die Buchung.
 */

// Dieselben Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};

let cleanup: { companyId: string; bookingId: string; cookie: string } | null = null;

test.beforeAll(() => {
  seedDemo(STAFF);
});

test.afterAll(async ({ request }) => {
  if (cleanup !== null) {
    const response = await request.post(
      `${API_URL}/api/v1/companies/${cleanup.companyId}/bookings/${cleanup.bookingId}/cancel`,
      { headers: { Cookie: cleanup.cookie }, data: { reason: 'OTHER' } },
    );
    expect(response.status()).toBe(200);
  }
});

async function staffLogin(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API_URL}/api/v1/auth/login`, { data: STAFF });
  expect(login.status()).toBe(200);
  const cookie = /__Host-masar_session=[^;]+/.exec(login.headers()['set-cookie'] ?? '')?.[0];
  if (cookie === undefined) throw new Error('Kein Sitzungs-Cookie');
  return cookie;
}

test.use({ locale: 'ar-SY' });

test('Fahrgast reserviert bar, Personal bestätigt, Ticket zeigt den QR-Code', async ({
  page,
  request,
}) => {
  const trip = await seedTrip(request, 4, 0);
  const [seat] = await freeSeats(request, trip, 'FEMALE', 1);
  if (seat === undefined) throw new Error('Kein Sitz');

  // 1. Fahrgast: Suche, Daten mit Geschlecht, Sitz, Hold, Barzahlung (ADR 0034).
  await searchAndOpenTrip(page, 'ar', { days: 4, passengers: 1, index: 0 });
  await fillPassengerDetails(
    page,
    'ar',
    [{ name: 'ليلى منصور', gender: 'FEMALE' }],
    randomPhone().local,
  );
  await page.getByText(seat.label, { exact: true }).click();
  await page.getByRole('button', { name: 'احجز المقاعد مؤقتاً' }).click();
  await expect(page).toHaveURL(/\/ar\/bookings\/[0-9a-f-]{36}\/pay#token=/);
  await page.getByRole('button', { name: 'احجز وادفع نقداً' }).click();
  await expect(page).toHaveURL(/\/ar\/bookings\/[0-9a-f-]{36}#token=/);
  await expect(page.getByText('محجوز، الدفع نقداً', { exact: true })).toBeVisible();
  const code = (await page.locator('bdi[translate="no"]').innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // 2. Personal am Schalter: anmelden, eigene Firma, Buchung über den Code, bar bestätigen.
  const cookie = await staffLogin(request);
  const me = (await (
    await request.get(`${API_URL}/api/v1/auth/me`, { headers: { Cookie: cookie } })
  ).json()) as { user: { memberships: { companyId: string; role: string }[] } };
  const companyId = me.user.memberships[0]?.companyId ?? '';
  expect(companyId).toBe(trip.companyId);
  const lookup = await request.post(`${API_URL}/api/v1/companies/${companyId}/bookings/lookup`, {
    headers: { Cookie: cookie },
    data: { bookingCode: code.toLowerCase() },
  });
  expect(lookup.status()).toBe(200);
  const found = (await lookup.json()) as { id: string; status: string };
  expect(found.status).toBe('RESERVED');
  cleanup = { companyId, bookingId: found.id, cookie };
  const confirmed = await request.post(
    `${API_URL}/api/v1/companies/${companyId}/bookings/${found.id}/confirm-cash`,
    { headers: { Cookie: cookie } },
  );
  expect(confirmed.status()).toBe(200);
  expect(((await confirmed.json()) as { status: string }).status).toBe('CONFIRMED');

  // 3. Fahrgast lädt die Ticketseite neu: bestätigt, mit QR-Code zum Vorzeigen.
  await page.reload();
  await expect(page.getByText('مؤكد', { exact: true })).toBeVisible();
  await expect(page.getByText('حجزك مؤكد.', { exact: false })).toBeVisible();
  const qr = page.getByRole('img', { name: `رمز الاستجابة السريعة للمقعد ${seat.label}` });
  await expect(qr).toBeVisible();
  await expect(qr.locator('path')).toHaveAttribute('d', /^M\d+ \d+h/);
  expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
});
