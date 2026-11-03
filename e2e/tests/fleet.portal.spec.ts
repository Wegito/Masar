import { randomInt } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import { ARABIC_INDIC_DIGIT, seedDemo } from '../support/flow';

/**
 * Flotte im Portal (Schritt 2.2): Liste mit dem Demo-Sitzplan, Anlegeformular mit Vorschau aus dem
 * Generator, Sitzplan anzeigen, Bus anlegen und deaktivieren, Sitzplan archivieren, Fehlertext für
 * einen doppelten Namen. Namen und Kennzeichen sind je Lauf neu, weil die Testdatenbank Läufe
 * überdauert.
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
    fleet: 'الأسطول',
    layouts: 'مخططات المقاعد',
    buses: 'الباصات',
    locked: 'مستخدم في رحلات',
    name: 'الاسم',
    pattern: 'توزيع المقاعد',
    rows: 'الصفوف العادية',
    withBench: 'مقعد خلفي',
    previewSummary: 'عدد المقاعد: 18، أزواج المقاعد المتجاورة لقاعدة الجلوس: 6',
    createLayout: 'إنشاء مخطط المقاعد',
    created: 'تم إنشاء مخطط المقاعد',
    show: 'عرض المخطط',
    mapLabel: (name: string) => `مخطط المقاعد ${name}`,
    nameTaken: 'يوجد مخطط مقاعد بهذا الاسم',
    plate: 'رقم اللوحة',
    busLayout: 'مخطط المقاعد',
    option: (name: string) => `${name}، النسخة 1 (عدد المقاعد: 18)`,
    addBus: 'إضافة الباص',
    busCreated: 'تمت إضافة الباص',
    deactivate: 'إيقاف',
    inactive: 'متوقف',
    archive: 'أرشفة',
    archived: 'مؤرشف',
  },
  en: {
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    nav: 'Portal sections',
    fleet: 'Fleet',
    layouts: 'Seat layouts',
    buses: 'Buses',
    locked: 'Used by trips',
    name: 'Name',
    pattern: 'Seat pattern',
    rows: 'Regular rows',
    withBench: 'Back bench',
    previewSummary: '18 seats, 6 neighbour pairs for the seating rule',
    createLayout: 'Create seat layout',
    created: 'Seat layout',
    show: 'Show layout',
    mapLabel: (name: string) => `Seat layout ${name}`,
    nameTaken: 'A seat layout with this name already exists',
    plate: 'Plate number',
    busLayout: 'Seat layout',
    option: (name: string) => `${name}, version 1 (18 seats)`,
    addBus: 'Add bus',
    busCreated: 'added',
    deactivate: 'Deactivate',
    inactive: 'Inactive',
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

  test(`Flotte (${locale}): Sitzplan mit Vorschau anlegen, Bus anlegen, deaktivieren, archivieren`, async ({
    page,
  }) => {
    const suffix = String(randomInt(100_000, 999_999));
    const layoutName = `E2E ${locale} ${suffix}`;
    const plate = `E2E-${locale.toUpperCase()}-${suffix}`;

    await page.goto(`/${locale}/fleet`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
    await page.getByLabel(text.login.email).fill(STAFF.email);
    await page.getByLabel(text.login.password, { exact: true }).fill(STAFF.password);
    await page.getByRole('button', { name: text.login.submit }).click();

    const nav = page.getByRole('navigation', { name: text.nav });
    await nav.getByRole('link', { name: text.fleet }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/fleet$`));
    await expect(page.getByRole('heading', { level: 1, name: text.fleet })).toBeVisible();
    await expect(page.getByRole('heading', { name: text.layouts, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: text.buses, exact: true })).toBeVisible();

    // Der Demo-Sitzplan wird von Fahrten genutzt und ist deshalb gesperrt.
    const demo = page.getByRole('article', { name: 'Standard 45' });
    await expect(demo.getByText(text.locked)).toBeVisible();
    await expect(page.getByRole('article', { name: 'DEMO-001' })).toBeVisible();

    // Anlegeformular: 2+1 mit sechs Reihen, ohne Hinterbank; die Vorschau folgt der Eingabe.
    await page.getByLabel(text.name, { exact: true }).fill(layoutName);
    await page.getByLabel(text.pattern).selectOption('TWO_PLUS_ONE');
    await page.getByLabel(text.rows).fill('6');
    await page.getByRole('checkbox', { name: text.withBench }).uncheck();
    await expect(page.getByTestId('preview-summary')).toHaveText(text.previewSummary);
    const previewMap = page.locator('form figure [role="img"]');
    await expect(previewMap.locator('[data-seat]')).toHaveCount(18);
    // Grundriss bleibt links-nach-rechts, auch auf Arabisch.
    await expect(previewMap).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: text.createLayout }).click();
    await expect(page.getByRole('status')).toContainText(text.created);

    const created = page.getByRole('article', { name: layoutName });
    await created.getByRole('button', { name: text.show }).click();
    const map = page.getByRole('img', { name: text.mapLabel(layoutName) });
    await expect(map.locator('[data-seat]')).toHaveCount(18);
    await expect(map.locator('[data-seat="6C"]')).toBeVisible();

    // Derselbe Name noch einmal: verständliche Meldung statt eines zweiten Plans.
    await page.getByLabel(text.name, { exact: true }).fill(layoutName);
    await page.getByRole('button', { name: text.createLayout }).click();
    await expect(alert(page, text.nameTaken)).toBeVisible();

    // Bus mit dem neuen Sitzplan anlegen und deaktivieren.
    await page.getByLabel(text.plate).fill(plate.toLowerCase());
    await page.getByRole('combobox', { name: text.busLayout }).selectOption({
      label: text.option(layoutName),
    });
    await page.getByRole('button', { name: text.addBus }).click();
    await expect(page.getByRole('status')).toContainText(text.busCreated);
    const bus = page.getByRole('article', { name: plate });
    await bus.getByRole('button', { name: text.deactivate }).click();
    await expect(bus.getByText(text.inactive, { exact: true })).toBeVisible();

    // Archivieren: Status wechselt, und der Plan steht nicht mehr zur Wahl für neue Busse.
    await created.getByRole('button', { name: text.archive }).click();
    await expect(created.getByText(text.archived, { exact: true })).toBeVisible();
    await expect(created.getByRole('button', { name: text.archive })).toHaveCount(0);
    await expect(
      page
        .getByRole('combobox', { name: text.busLayout })
        .locator('option', { hasText: layoutName }),
    ).toHaveCount(0);

    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
  });
}
