import { randomInt } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import { ARABIC_INDIC_DIGIT, seedDemo } from '../support/flow';

/**
 * Strecken im Portal (Schritt 2.3): Liste mit der Demo-Strecke (von Fahrten genutzt), Tarifmatrix
 * ansehen, Standard-Stornoregel anlegen, neue Strecke mit drei Halten in Reihenfolge und einer
 * Tarifmatrix aus dem Vorschlag je Abschnitt anlegen, Fehlertext für einen zu niedrigen Preis,
 * Strecke ansehen und archivieren. Namen sind je Lauf neu, weil die Testdatenbank Läufe überdauert.
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
    routes: 'الخطوط',
    demoRoute: 'دمشق – حمص – حماة – حلب',
    locked: 'مستخدم في رحلات',
    show: 'عرض التفاصيل',
    matrix: (name: string) => `أسعار ${name}`,
    station: (city: string) => `${city} – محطة تجريبية`,
    cities: ['دمشق', 'حمص', 'حلب'],
    createStandard: 'إنشاء السياسة المعتادة',
    standardCreated: 'تم إنشاء سياسة الإلغاء',
    nameAr: 'الاسم بالعربية',
    nameEn: 'الاسم بالإنجليزية',
    city: 'المدينة',
    stopsList: 'المحطات بترتيب السير',
    addStop: 'إضافة المحطة',
    leg: (from: string, to: string) => `${from} ← ${to}`,
    applySuggestion: 'تعبئة الاقتراح',
    fareFor: (from: string, to: string) => `السعر من ${from} إلى ${to}`,
    submit: 'إنشاء الخط',
    notMonotonic: 'أقل من السعر من',
    created: 'تم إنشاء الخط',
    archive: 'أرشفة',
    archived: 'مؤرشف',
  },
  en: {
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    nav: 'Portal sections',
    routes: 'Routes',
    demoRoute: 'Damascus – Homs – Hama – Aleppo',
    locked: 'Used by trips',
    show: 'Show details',
    matrix: (name: string) => `Fares of ${name}`,
    station: (city: string) => `${city} Demo Terminal`,
    cities: ['Damascus', 'Homs', 'Aleppo'],
    createStandard: 'Create standard policy',
    standardCreated: 'Cancellation policy',
    nameAr: 'Name in Arabic',
    nameEn: 'Name in English',
    city: 'City',
    stopsList: 'Stops in travel order',
    addStop: 'Add stop',
    leg: (from: string, to: string) => `${from} → ${to}`,
    applySuggestion: 'Fill in suggestion',
    fareFor: (from: string, to: string) => `Fare from ${from} to ${to}`,
    submit: 'Create route',
    notMonotonic: 'is lower than the fare from',
    created: 'Route',
    archive: 'Archive',
    archived: 'Archived',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF);
});

/** Fehlertext der Seite; Next hat einen eigenen, leeren Bereich mit role=alert. */
function alert(page: Page, text: string): ReturnType<Page['getByRole']> {
  return page.getByRole('alert').filter({ hasText: text });
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Strecken (${locale}): ansehen, Stornoregel und Strecke mit Tarifmatrix anlegen, archivieren`, async ({
    page,
  }) => {
    const suffix = String(randomInt(100_000, 999_999));
    const nameAr = `خط تجريبي ${suffix}`;
    const nameEn = `E2E route ${suffix}`;
    const ownName = locale === 'ar' ? nameAr : nameEn;
    const [damascus, homs, aleppo] = text.cities.map((city) => text.station(city)) as [
      string,
      string,
      string,
    ];

    await page.goto(`/${locale}/routes`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
    await page.getByLabel(text.login.email).fill(STAFF.email);
    await page.getByLabel(text.login.password, { exact: true }).fill(STAFF.password);
    await page.getByRole('button', { name: text.login.submit }).click();

    const nav = page.getByRole('navigation', { name: text.nav });
    await nav.getByRole('link', { name: text.routes }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/routes$`));
    await expect(page.getByRole('heading', { level: 1, name: text.routes })).toBeVisible();

    // Die Demo-Strecke wird von Fahrten genutzt; ihre Matrix zeigt sechs Preise.
    const demo = page.getByRole('article', { name: text.demoRoute });
    await expect(demo.getByText(text.locked)).toBeVisible();
    await demo.getByRole('button', { name: text.show }).click();
    const demoMatrix = page.getByRole('table', { name: text.matrix(text.demoRoute) });
    await expect(demoMatrix.locator('td').filter({ hasText: /\d/ })).toHaveCount(6);

    // Standard-Stornoregel aus dem Vorschlag anlegen.
    await page.getByRole('button', { name: text.createStandard }).click();
    await expect(page.getByRole('status')).toContainText(text.standardCreated);

    // Neue Strecke: Namen, drei Halte in Reihenfolge.
    await page.getByLabel(text.nameAr).fill(nameAr);
    await page.getByLabel(text.nameEn).fill(nameEn);
    for (const city of text.cities) {
      await page.getByRole('combobox', { name: text.city }).selectOption({ label: city });
      await page.getByRole('button', { name: text.addStop }).click();
    }
    const chosen = page.getByRole('list', { name: text.stopsList });
    await expect(chosen.getByRole('listitem')).toHaveCount(3);
    await expect(chosen.getByRole('listitem').nth(2)).toContainText(aleppo);

    // Vorschlag aus einem Preis je Abschnitt: Damaskus–Aleppo ist die Summe.
    await page.getByRole('textbox', { name: text.leg(damascus, homs) }).fill('200');
    await page.getByRole('textbox', { name: text.leg(homs, aleppo) }).fill('300');
    await page.getByRole('button', { name: text.applySuggestion }).click();
    const through = page.getByRole('textbox', { name: text.fareFor(damascus, aleppo) });
    await expect(through).toHaveValue('500');
    await expect(page.getByRole('textbox', { name: text.fareFor(homs, aleppo) })).toHaveValue(
      '300',
    );

    // Ein Durchgangspreis unter einem enthaltenen Abschnitt: verständliche Meldung der API.
    await through.fill('250');
    await page.getByRole('button', { name: text.submit }).click();
    await expect(alert(page, text.notMonotonic)).toBeVisible();

    await through.fill('500');
    await page.getByRole('button', { name: text.submit }).click();
    await expect(page.getByRole('status')).toContainText(text.created);

    // Ansehen: Halte und Matrix der neuen Strecke.
    const created = page.getByRole('article', { name: ownName });
    await created.getByRole('button', { name: text.show }).click();
    const matrix = page.getByRole('table', { name: text.matrix(ownName) });
    await expect(matrix.locator('td').filter({ hasText: /\d/ })).toHaveCount(3);
    await expect(created.getByRole('listitem').filter({ hasText: homs })).toBeVisible();

    // Archivieren: Status wechselt, die Aktion verschwindet.
    await created.getByRole('button', { name: text.archive }).click();
    await expect(created.getByText(text.archived, { exact: true })).toBeVisible();
    await expect(created.getByRole('button', { name: text.archive })).toHaveCount(0);

    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
  });
}
