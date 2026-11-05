import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { ARABIC_INDIC_DIGIT, damascusDay, randomPhone, seedDemo, watchUrls } from '../support/flow';
import { signIn } from '../support/portal-auth';

/**
 * Buchungsliste im Portal (Schritt 2.5, ADR 0028): Barreservierung an der Oberfläche vorbei
 * anlegen, in der Liste über Tag und die letzten Ziffern der Telefonnummer finden (Telefon
 * maskiert), Suche nach einem Namen abgelehnt, Detail mit Zahlungsstand und Verlauf, Telefon erst
 * auf Klick, bar bestätigen, Fahrgastliste aus der Detailansicht und aus den Fahrten, Karten auf
 * dem Smartphone, zuletzt stornieren (gibt den Sitz für den nächsten Lauf frei). Alle Aufrufe an
 * die API gehen über das Portal (Rewrite /api), damit der Test nicht vom Port der API abhängt.
 */

// Dieselben Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};
const DAYS = 6;

const TEXT = {
  ar: {
    index: 1,
    login: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
    q: 'الرمز أو الهاتف',
    day: 'يوم الانطلاق (YYYY-MM-DD)',
    apply: 'تطبيق التصفية',
    searchInvalid: 'البحث بالأسماء غير متاح',
    open: 'فتح',
    detail: 'تفاصيل الحجز',
    reserved: 'محجوز، الدفع نقداً',
    cashDue: 'الدفع نقداً مستحق',
    paid: 'مدفوع',
    history: ['حجز المقاعد مؤقتاً', 'اختيار الدفع نقداً'],
    confirmedEntry: 'تأكيد الدفع النقدي',
    reveal: 'إظهار',
    revealed: 'يُسجَّل هذا الاطلاع',
    confirmCash: 'تأكيد الدفع النقدي',
    confirmed: 'مؤكد',
    passengersLink: 'قائمة ركاب هذه الرحلة',
    passengersTitle: 'قائمة الركاب',
    male: 'ذكر',
    tripsShow: 'عرض التفاصيل',
    tripsPassengers: 'قائمة الركاب (الحجوزات النشطة:',
    cancel: 'إلغاء الحجز',
    reason: 'سبب الإلغاء',
    cancelConfirm: 'ألغِ الحجز الآن',
    cancelled: 'ملغى',
  },
  en: {
    index: 2,
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    q: 'Code or phone',
    day: 'Departure day (YYYY-MM-DD)',
    apply: 'Apply filters',
    searchInvalid: 'Names cannot be searched',
    open: 'Open',
    detail: 'Booking details',
    reserved: 'Reserved, pay in cash',
    cashDue: 'Cash due',
    paid: 'Paid',
    history: ['Seats held', 'Cash payment chosen'],
    confirmedEntry: 'Cash payment confirmed',
    reveal: 'Show',
    revealed: 'This access is recorded',
    confirmCash: 'Confirm cash payment',
    confirmed: 'Confirmed',
    passengersLink: 'Passenger list of this trip',
    passengersTitle: 'Passenger list',
    male: 'Male',
    tripsShow: 'Show details',
    tripsPassengers: 'Passenger list (',
    cancel: 'Cancel booking',
    reason: 'Reason for cancellation',
    cancelConfirm: 'Cancel booking now',
    cancelled: 'Cancelled',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF);
});

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.url()}: ${String(response.status())} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

interface Reservation {
  id: string;
  bookingCode: string;
  tripId: string;
  seatLabel: string;
  name: string;
  phone: ReturnType<typeof randomPhone>;
}

/** Barreservierung über die API (Hold, dann „bar zahlen") am Tag `DAYS`, Abfahrt `index`. */
async function cashReservation(request: APIRequestContext, index: number): Promise<Reservation> {
  const cities = await json<{ items: { id: string; nameEn: string }[] }>(
    await request.get('/api/v1/cities'),
  );
  const city = (name: string): string => cities.items.find((c) => c.nameEn === name)?.id ?? '';
  const search = await json<{
    items: { tripId: string; from: { tripStopId: string }; to: { tripStopId: string } }[];
  }>(
    await request.get('/api/v1/trips/search', {
      params: { from: city('Damascus'), to: city('Aleppo'), date: damascusDay(DAYS) },
    }),
  );
  const trip = search.items[index];
  if (trip === undefined) throw new Error('Keine Fahrt im Seed');
  const seatMap = await json<{
    seats: { seatId: string; label: string; state: string; notFor: string[] }[];
  }>(
    await request.post(`/api/v1/trips/${trip.tripId}/seat-map`, {
      data: { fromStopId: trip.from.tripStopId, toStopId: trip.to.tripStopId, genders: ['MALE'] },
    }),
  );
  const seat = seatMap.seats.find(
    (s) => s.state === 'FREE' && !s.notFor.includes('MALE') && !s.label.startsWith('11'),
  );
  if (seat === undefined) throw new Error('Kein freier Sitz; Testdatenbank neu aufsetzen');
  const phone = randomPhone();
  const name = 'Nour Haddad';
  const held = await json<{ booking: { id: string; bookingCode: string }; manageToken: string }>(
    await request.post('/api/v1/bookings', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        tripId: trip.tripId,
        fromStopId: trip.from.tripStopId,
        toStopId: trip.to.tripStopId,
        locale: 'en',
        contact: { name, phone: phone.e164 },
        passengers: [
          { seatId: seat.seatId, fullName: name, gender: 'MALE', nationalId: '01020304050' },
        ],
      },
    }),
  );
  const reserved = await request.post(`/api/v1/bookings/${held.booking.id}/reserve-cash`, {
    headers: { 'X-Manage-Token': held.manageToken },
  });
  expect(reserved.status()).toBe(200);
  return {
    id: held.booking.id,
    bookingCode: held.booking.bookingCode,
    tripId: trip.tripId,
    seatLabel: seat.label,
    name,
    phone,
  };
}

async function login(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await signIn(page, locale, STAFF);
  await page.goto(`/${locale}/bookings`);
}

function alerts(page: Page): ReturnType<Page['getByRole']> {
  return page.locator('main').getByRole('alert');
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Buchungsliste (${locale}): filtern, Detail, Telefon auf Klick, bar bestätigen, Fahrgastliste`, async ({
    page,
  }) => {
    const booking = await cashReservation(page.request, text.index);
    const urls = watchUrls(page);
    const codeText = `${booking.bookingCode.slice(0, 4)}-${booking.bookingCode.slice(4)}`;
    const masked = `+963 9** *** ${booking.phone.e164.slice(-3)}`;
    await login(page, locale);

    // Liste: Tag der Abfahrt und die letzten Ziffern der Telefonnummer.
    const filters = page.getByRole('form', {
      name: locale === 'ar' ? 'تصفية الحجوزات' : 'Filter bookings',
    });
    await filters.getByLabel(text.day).fill(damascusDay(DAYS));
    await filters.getByLabel(text.q).fill(booking.phone.e164.slice(-6));
    await filters.getByRole('button', { name: text.apply }).click();
    const row = page.locator(`tr[data-booking-id="${booking.id}"]`);
    await expect(row).toContainText(codeText);
    await expect(row).toContainText(booking.name);
    await expect(row).toContainText(masked);
    await expect(row).toContainText(text.cashDue);
    expect(await page.locator('main').innerText()).not.toContain(booking.phone.e164.slice(4));

    // Suche nach einem Namen: verständlich abgelehnt.
    await filters.getByLabel(text.q).fill('Nour Haddad');
    await filters.getByRole('button', { name: text.apply }).click();
    await expect(alerts(page).filter({ hasText: text.searchInvalid })).toBeVisible();

    // Zurück zum Treffer, dann ins Detail.
    await filters.getByLabel(text.q).fill(booking.bookingCode.slice(0, 6));
    await filters.getByRole('button', { name: text.apply }).click();
    await row.getByRole('link', { name: new RegExp(text.open) }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/bookings/${booking.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: text.detail })).toBeVisible();
    const card = page.locator(`article[data-booking-id="${booking.id}"]`);
    await expect(card.getByText(text.reserved, { exact: true })).toBeVisible();
    await expect(card.getByText(text.cashDue, { exact: true })).toBeVisible();
    await expect(card.getByText(text.male).first()).toBeVisible();
    for (const entry of text.history) {
      await expect(card.getByRole('listitem').filter({ hasText: entry })).toBeVisible();
    }
    await expect(card.getByTestId('contact-phone')).toHaveText(masked);

    // Telefon erst auf Klick; die API vermerkt den Zugriff.
    await card.getByRole('button', { name: text.reveal, exact: true }).click();
    await expect(card.getByTestId('contact-phone')).toHaveText(booking.phone.e164);
    await expect(card.getByText(text.revealed)).toBeVisible();

    await card.getByRole('button', { name: text.confirmCash }).click();
    await expect(card.getByText(text.confirmed, { exact: true })).toBeVisible();
    await expect(card.getByText(text.paid, { exact: true })).toBeVisible();
    await expect(card.getByRole('listitem').filter({ hasText: text.confirmedEntry })).toBeVisible();

    // Fahrgastliste aus dem Detail: Sitz, Name, bezahlt, ohne Kontaktdaten.
    await page.getByRole('link', { name: text.passengersLink }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/trips/${booking.tripId}/passengers$`));
    await expect(page.getByRole('heading', { level: 1, name: text.passengersTitle })).toBeVisible();
    const seatRow = page.locator(`tr[data-seat="${booking.seatLabel}"]`).filter({
      hasText: booking.name,
    });
    await expect(seatRow).toContainText(text.paid);
    const passengerText = await page.locator('main').innerText();
    expect(passengerText).not.toContain(booking.phone.e164.slice(-6));
    expect(passengerText).not.toContain(codeText);
    expect(passengerText).not.toContain('01020304050');
    expect(passengerText).not.toMatch(ARABIC_INDIC_DIGIT);

    // Auf dem Smartphone Karten statt Tabelle.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('table')).toBeHidden();
    await expect(
      page.locator(`li[data-seat="${booking.seatLabel}"]`).filter({ hasText: booking.name }),
    ).toBeVisible();
    await page.goto(`/${locale}/bookings`);
    await filters.getByLabel(text.q).fill(booking.bookingCode);
    await filters.getByRole('button', { name: text.apply }).click();
    const mobileCard = page.locator(`li[data-booking-id="${booking.id}"]`);
    await expect(mobileCard).toContainText(codeText);
    await expect(mobileCard).toContainText(masked);
    await expect(page.locator(`tr[data-booking-id="${booking.id}"]`)).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });

    // Link aus der Fahrten-Detailansicht.
    await page.goto(`/${locale}/trips`);
    const tripArticle = page.locator(`article[data-trip-id="${booking.tripId}"]`);
    await tripArticle.getByRole('button', { name: text.tripsShow }).click();
    await tripArticle.getByRole('link', { name: new RegExp(escape(text.tripsPassengers)) }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/trips/${booking.tripId}/passengers$`));
    await expect(page.locator(`tr[data-seat="${booking.seatLabel}"]`).first()).toBeVisible();

    // Aufräumen über das Detail: stornieren gibt den Sitz frei.
    await page.goto(`/${locale}/bookings/${booking.id}`);
    await card.getByRole('button', { name: text.cancel }).click();
    await card.getByLabel(text.reason).selectOption('OTHER');
    await card.getByRole('button', { name: text.cancelConfirm }).click();
    await expect(card.getByText(text.cancelled, { exact: true })).toBeVisible();

    // Weder Code noch Telefon standen je in der Adresse einer Seite.
    const pages = urls.filter((url) => !url.includes('/api/'));
    for (const url of pages) {
      expect(url).not.toContain(booking.bookingCode);
      expect(url).not.toContain(booking.phone.e164.slice(-6));
    }
  });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
