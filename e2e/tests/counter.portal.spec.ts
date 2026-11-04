import { expect, type Page, test } from '@playwright/test';

import {
  ARABIC_INDIC_DIGIT,
  damascusDay,
  damascusTime,
  randomPhone,
  seedDemo,
  seedTrip,
  watchUrls,
} from '../support/flow';

/**
 * Schaltermodus im Portal (Schritt 2.6, ADR 0030): anmelden, Fahrt des Tages wählen, Teilstrecke,
 * einen Sitz außerhalb des Online-Kontingents antippen, Fahrgast und Kontakt eingeben, Preis
 * sehen, bar verkaufen, Ticket mit QR-Code und Zeit in Damaskus drucken. Danach über die
 * vorhandene Storno-Aktion im Detail stornieren (gibt den Sitz für den nächsten Lauf frei).
 */

// Dieselben Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};
const DAYS = 3;

const TEXT = {
  ar: {
    index: 1,
    login: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
    nav: 'الشباك',
    title: 'الشباك',
    day: 'يوم الانطلاق',
    trip: 'الرحلة',
    from: 'من',
    to: 'إلى',
    gender: 'الجنس',
    female: 'أنثى',
    name: 'الاسم',
    phone: 'رقم الجوال',
    sell: 'بيع وتحصيل',
    sold: 'تم البيع',
    print: 'طباعة التذكرة',
    ticket: 'التذكرة',
    confirmed: 'مؤكد',
    paid: 'مدفوع',
    cancel: 'إلغاء الحجز',
    reason: 'سبب الإلغاء',
    cancelConfirm: 'ألغِ الحجز الآن',
    cancelled: 'ملغى',
  },
  en: {
    index: 2,
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    nav: 'Counter',
    title: 'Counter',
    day: 'Departure day',
    trip: 'Trip',
    from: 'From',
    to: 'To',
    gender: 'Gender',
    female: 'Female',
    name: 'Name',
    phone: 'Mobile number',
    sell: 'Sell and collect',
    sold: 'Sold',
    print: 'Print ticket',
    ticket: 'Ticket',
    confirmed: 'Confirmed',
    paid: 'Paid',
    cancel: 'Cancel booking',
    reason: 'Reason for cancellation',
    cancelConfirm: 'Cancel booking now',
    cancelled: 'Cancelled',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF);
});

async function login(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const text = TEXT[locale];
  await page.goto(`/${locale}/counter`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
  await page.getByLabel(text.login.email).fill(STAFF.email);
  await page.getByLabel(text.login.password, { exact: true }).fill(STAFF.password);
  await page.getByRole('button', { name: text.login.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

interface MapSeat {
  seatId: string;
  label: string;
  quota: string;
  state: string;
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Schalter (${locale}): Sitz außerhalb des Online-Kontingents bar verkaufen und Ticket drucken`, async ({
    page,
  }) => {
    const trip = await seedTrip(page.request, DAYS, text.index);
    const urls = watchUrls(page);
    const phone = randomPhone();
    const name = 'Rania Haddad';
    await login(page, locale);

    // Navigation: „Schalter" ist aktiv.
    await page.getByRole('navigation').getByRole('link', { name: text.nav }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/counter$`));
    await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();

    // Freier Schalter-Sitz laut Sitzplan des Personals (über das Portal, mit Sitzung).
    const before = await page.request.get(
      `/api/v1/companies/${trip.companyId}/trips/${trip.tripId}/counter-seat-map`,
    );
    expect(before.status()).toBe(200);
    const seats = ((await before.json()) as { seats: MapSeat[] }).seats;
    const seat = seats.find((s) => s.quota === 'COUNTER' && s.state === 'FREE');
    if (seat === undefined)
      throw new Error('Kein freier Schalter-Sitz; Testdatenbank neu aufsetzen');

    await page.getByLabel(text.day).fill(damascusDay(DAYS));
    const tripSelect = page.getByRole('combobox', { name: text.trip, exact: true });
    await expect(tripSelect.locator(`option[value="${trip.tripId}"]`)).toHaveCount(1);
    await tripSelect.selectOption(trip.tripId);
    await expect(page.getByRole('combobox', { name: text.from, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: text.to, exact: true })).toBeVisible();

    const seatButton = page.locator(`button[data-seat="${seat.label}"]`);
    await expect(seatButton).toHaveAttribute('data-quota', 'COUNTER');
    await seatButton.click();
    await expect(seatButton).toHaveAttribute('aria-pressed', 'true');

    const passenger = page.locator(`li[data-passenger-seat="${seat.label}"]`);
    await passenger
      .getByRole('combobox', { name: text.gender, exact: true })
      .selectOption('FEMALE');
    await page.getByLabel(text.name, { exact: true }).fill(name);
    // Der Hinweis unter dem Feld gehört zum Namen des Felds; deshalb nur der Anfang.
    await page.getByRole('textbox', { name: new RegExp(`^${text.phone}`) }).fill(phone.local);
    await expect(page.getByTestId('counter-total')).not.toBeEmpty();
    await page.getByRole('button', { name: new RegExp(text.sell) }).click();

    await expect(page.getByRole('heading', { name: text.sold, exact: true })).toBeVisible();
    const card = page.locator('article[data-booking-id]');
    await expect(card.getByText(text.confirmed, { exact: true })).toBeVisible();
    await expect(card.getByText(text.paid, { exact: true })).toBeVisible();
    const bookingId = await card.getAttribute('data-booking-id');
    expect(bookingId).not.toBeNull();
    expect(await page.locator('main').innerText()).not.toContain(phone.e164.slice(4));

    // Sitz ist jetzt belegt, online wie am Schalter.
    const after = await page.request.get(
      `/api/v1/companies/${trip.companyId}/trips/${trip.tripId}/counter-seat-map`,
    );
    const taken = ((await after.json()) as { seats: MapSeat[] }).seats.find(
      (s) => s.seatId === seat.seatId,
    );
    expect(taken?.state).toBe('TAKEN');

    // Druckansicht: QR-Code, Code, Sitz, Name, Zeit in Damaskus, westliche Ziffern.
    await page.getByRole('link', { name: text.print }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/counter/tickets/${bookingId!}$`));
    await expect(page.getByRole('heading', { level: 1, name: text.ticket })).toBeVisible();
    const ticket = page.locator(`li[data-ticket-seat="${seat.label}"]`);
    await expect(ticket.locator('svg[role="img"] path')).toHaveCount(1);
    await expect(ticket).toContainText(name);
    await expect(ticket.getByTestId('ticket-departure')).toContainText(
      damascusTime(trip.departureAt),
    );
    const ticketText = await page.locator('main').innerText();
    expect(ticketText).toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}/);
    expect(ticketText).not.toMatch(ARABIC_INDIC_DIGIT);
    expect(ticketText).not.toContain(phone.e164.slice(4));
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('header')).toBeHidden();
    await expect(page.getByRole('navigation')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    // Storno über die vorhandene Aktion; der Sitz wird wieder frei.
    await page.goto(`/${locale}/bookings/${bookingId!}`);
    const detail = page.locator(`article[data-booking-id="${bookingId!}"]`);
    await detail.getByRole('button', { name: text.cancel }).click();
    await detail.getByLabel(text.reason).selectOption('OTHER');
    await detail.getByRole('button', { name: text.cancelConfirm }).click();
    await expect(detail.getByText(text.cancelled, { exact: true })).toBeVisible();

    // Weder Telefon noch Code standen je in der Adresse einer Seite.
    for (const url of urls.filter((entry) => !entry.includes('/api/'))) {
      expect(url).not.toContain(phone.e164.slice(4));
    }
  });
}
