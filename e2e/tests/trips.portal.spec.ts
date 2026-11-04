import { randomInt } from 'node:crypto';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { ARABIC_INDIC_DIGIT, damascusDay, damascusTime, seedDemo } from '../support/flow';

/**
 * Fahrten im Portal (Schritt 2.4): Liste mit den Demo-Fahrten und ihrem Kontingent, Details mit
 * Halten und Grundriss, Woche planen mit Vorschau über die API, veröffentlichen, zweite Vorschau
 * ohne neue Termine (idempotent), die neue Fahrt in der öffentlichen Suche der Fahrgast-App, Fahrt
 * absagen mit Bestätigung und danach nicht mehr in der Suche. Tag und Uhrzeit sind je Lauf
 * zufällig, weil die Testdatenbank Läufe überdauert; der Plan nutzt nur den Sitzplan, damit der
 * Demo-Bus (07:00, 15:00, 23:00) nicht doppelt belegt wird.
 */

// Dieselben Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};

const TEXT = {
  ar: {
    login: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
    nav: 'أقسام البوابة',
    trips: 'الرحلات',
    demoRoute: 'دمشق – حمص – حماة – حلب',
    demoQuota: 'عبر الإنترنت: 37 · الشباك: 7 · محجوبة: 1',
    show: 'عرض التفاصيل',
    station: 'حمص – محطة تجريبية',
    route: 'الخط',
    vehicle: 'الحافلة أو مخطط المقاعد',
    layoutOption: 'مخطط المقاعد فقط: Standard 45 (الإصدار 1)',
    departureTime: 'الانطلاق (بتوقيت دمشق، HH:MM)',
    from: 'اليوم الأول (YYYY-MM-DD)',
    to: 'اليوم الأخير (YYYY-MM-DD)',
    preview: 'عرض المعاينة',
    submit: 'نشر',
    previewNew: 'عدد الرحلات: 1. جديدة: 1، مخطط لها مسبقاً: 0',
    previewExisting: 'عدد الرحلات: 1. جديدة: 0، مخطط لها مسبقاً: 1',
    published: 'تم النشر: رحلات جديدة 1، وتم تخطّي 0.',
    cancel: 'إلغاء الرحلة',
    cancelConfirm: 'ألغِ الرحلة الآن',
    cancelled: 'أُلغيت الرحلة',
    cancelledBadge: 'ملغاة',
    map: 'حصة مقاعد الرحلة في',
  },
  en: {
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    nav: 'Portal sections',
    trips: 'Trips',
    demoRoute: 'Damascus – Homs – Hama – Aleppo',
    demoQuota: 'Online: 37 · Counter: 7 · Blocked: 1',
    show: 'Show details',
    station: 'Homs Demo Terminal',
    route: 'Route',
    vehicle: 'Bus or seat layout',
    layoutOption: 'Seat layout only: Standard 45 (version 1)',
    departureTime: 'Departure (Damascus time, HH:MM)',
    from: 'First day (YYYY-MM-DD)',
    to: 'Last day (YYYY-MM-DD)',
    preview: 'Show preview',
    submit: 'Publish',
    previewNew: '1 trips: 1 new, 0 already planned',
    previewExisting: '1 trips: 0 new, 1 already planned',
    published: 'Published: 1 new trips, 0 skipped.',
    cancel: 'Cancel trip',
    cancelConfirm: 'Cancel trip now',
    cancelled: 'Trip cancelled',
    cancelledBadge: 'Cancelled',
    map: 'Seat quota of the trip on',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF);
});

/**
 * Fahrten Damaskus → Aleppo am Tag `day` aus der öffentlichen Suche der Fahrgast-App. Der Aufruf
 * geht über das Portal (Rewrite /api), damit der Test nicht vom Port der API abhängt.
 */
async function searchTrips(
  request: APIRequestContext,
  day: string,
): Promise<{ tripId: string; departureAt: string }[]> {
  const cities = (await (await request.get('/api/v1/cities')).json()) as {
    items: { id: string; nameEn: string }[];
  };
  const id = (name: string): string => cities.items.find((city) => city.nameEn === name)?.id ?? '';
  const res = await request.get('/api/v1/trips/search', {
    params: { from: id('Damascus'), to: id('Aleppo'), date: day },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { items: { tripId: string; departureAt: string }[] }).items;
}

/** Fehlertexte im Inhalt; Next meldet Seitenwechsel in einem eigenen Bereich mit role=alert. */
function alerts(page: Page): ReturnType<Page['getByRole']> {
  return page.locator('main').getByRole('alert');
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Fahrten (${locale}): ansehen, Woche planen, veröffentlichen, in der Suche finden, absagen`, async ({
    page,
  }) => {
    // Ein Tag nach den sieben Demo-Tagen, aber noch in der Liste (14 Tage); Uhrzeit 01:00–05:59.
    const day = damascusDay(randomInt(8, 14));
    const time = `0${String(randomInt(1, 6))}:${String(randomInt(0, 60)).padStart(2, '0')}`;

    await page.goto(`/${locale}/trips`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
    await page.getByLabel(text.login.email).fill(STAFF.email);
    await page.getByLabel(text.login.password, { exact: true }).fill(STAFF.password);
    await page.getByRole('button', { name: text.login.submit }).click();

    const nav = page.getByRole('navigation', { name: text.nav });
    await nav.getByRole('link', { name: text.trips }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/trips$`));
    await expect(page.getByRole('heading', { level: 1, name: text.trips })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // Demo-Fahrten mit dem Kontingent aus dem Seed: Reihen 9 und 10 am Schalter, 9A gesperrt.
    const demo = page.getByRole('article').filter({ hasText: text.demoRoute }).first();
    await expect(demo).toContainText(text.demoQuota);
    await demo.getByRole('button', { name: text.show }).click();
    await expect(demo.getByRole('listitem').filter({ hasText: text.station })).toBeVisible();
    await expect(demo.locator('[data-quota="COUNTER"]')).toHaveCount(7);
    await expect(demo.locator('[data-quota="BLOCKED"]')).toHaveCount(1);

    // Woche planen: Demo-Strecke, nur Sitzplan, ein Tag, alle Wochentage angehakt.
    await page.getByRole('combobox', { name: text.route }).selectOption({ label: text.demoRoute });
    await page
      .getByRole('combobox', { name: text.vehicle })
      .selectOption({ label: text.layoutOption });
    await page.getByRole('textbox', { name: text.departureTime }).fill(time);
    await page.getByRole('textbox', { name: text.from }).fill(day);
    await page.getByRole('textbox', { name: text.to }).fill(day);
    const publish = page.getByRole('button', { name: text.submit, exact: true });
    await expect(publish).toBeDisabled();
    await page.getByRole('button', { name: text.preview }).click();
    await expect(page.getByTestId('schedule-summary')).toContainText(text.previewNew);
    await expect(alerts(page)).toHaveCount(0);

    await publish.click();
    await expect(page.getByRole('status')).toContainText(text.published);

    // Zweite Vorschau desselben Plans: nichts Neues, Veröffentlichen bleibt gesperrt.
    await page.getByRole('button', { name: text.preview }).click();
    await expect(page.getByTestId('schedule-summary')).toContainText(text.previewExisting);
    await expect(publish).toBeDisabled();

    // Die neue Fahrt erscheint in der öffentlichen Suche der Fahrgast-App.
    const found = (await searchTrips(page.request, day)).filter(
      (item) => damascusTime(item.departureAt) === time,
    );
    expect(found).toHaveLength(1);
    const tripId = found[0]!.tripId;

    // In der Liste: Details mit allen 45 Sitzen online (Standard), dann absagen.
    const created = page.locator(`article[data-trip-id="${tripId}"]`);
    await expect(created).toContainText(time);
    await created.getByRole('button', { name: text.show }).click();
    await expect(created.getByRole('img', { name: new RegExp(text.map) })).toBeVisible();
    await expect(created.locator('[data-quota="ONLINE"]')).toHaveCount(45);
    await created.getByRole('button', { name: text.cancel }).click();
    await created.getByRole('button', { name: text.cancelConfirm }).click();
    await expect(page.getByRole('status')).toContainText(text.cancelled);
    await expect(created.getByText(text.cancelledBadge, { exact: true })).toBeVisible();
    await expect(created.getByRole('button', { name: text.cancel })).toHaveCount(0);

    expect((await searchTrips(page.request, day)).map((item) => item.tripId)).not.toContain(tripId);
    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
  });
}
