import { execSync } from 'node:child_process';

import { expect, type Page, test } from '@playwright/test';

import { API_DIR, TEST_DATABASE_URL } from '../support/env';

/**
 * Fahrgast-Ablauf Suche → Ergebnisse → Sitzwahl (Schritt 1.5, Teil 1) gegen die echte API. Die
 * Fahrten legt das Demo-Seed an (Damaskus → Homs → Hama → Aleppo, drei Abfahrten am Tag für sieben
 * Tage); es ist idempotent. Gesucht wird morgen, damit keine Abfahrt schon vorbei ist.
 */
test.beforeAll(() => {
  // Als Befehlszeile, damit es auch unter Windows startet (pnpm ist dort ein .cmd-Skript).
  execSync('pnpm run db:seed', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
});

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

/** Sammelt alle URLs, die der Browser anfragt: Das Geschlecht darf in keiner auftauchen. */
function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

const TEXT = {
  ar: { from: 'دمشق', to: 'حلب', submit: 'ابحث عن رحلات' },
  en: { from: 'Damascus', to: 'Aleppo', submit: 'Search trips' },
} as const;

/** Damaskus nach Aleppo, morgen, mit der gewünschten Anzahl Fahrgäste. */
async function search(page: Page, locale: 'ar' | 'en', passengers: string): Promise<void> {
  const selects = page.locator('form select');
  await selects.nth(0).selectOption({ label: TEXT[locale].from });
  await selects.nth(1).selectOption({ label: TEXT[locale].to });
  // Index 0 ist heute, 1 morgen.
  await selects.nth(2).selectOption({ index: 1 });
  await selects.nth(3).selectOption(passengers);
  await page.getByRole('button', { name: TEXT[locale].submit }).click();
  await expect(page).toHaveURL(/\/search\?/);
}

test.describe('arabisch', () => {
  test.use({ locale: 'ar-SY' });

  test('sucht, wählt eine Fahrt, bucht für Frauen und wählt zwei Sitze', async ({ page }) => {
    const urls = watchUrls(page);
    await page.goto('/ar');
    await search(page, 'ar', '2');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('من دمشق إلى حلب');
    const trips = page.getByRole('list', { name: 'الرحلات المتاحة' }).getByRole('link');
    await expect(trips).toHaveCount(3);
    const first = trips.first();
    await expect(first).toContainText('07:00');
    await expect(first).toContainText('12:20');
    await expect(first).toContainText('600');
    await expect(first).toContainText('ل.س.');
    await expect(first).toContainText('9+');
    // Die Nachtfahrt um 23:00 kommt am Folgetag an.
    await expect(trips.nth(2)).toContainText('+1');
    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);

    await first.click();
    await expect(page).toHaveURL(/\/ar\/trips\/[0-9a-f-]+\?from=.+&to=.+&passengers=2$/);
    await expect(page.getByRole('group', { name: 'أحجز لـ' })).toBeVisible();
    // Vor der Wahl gibt es noch keinen Sitzplan.
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    await page.getByText('نساء فقط').click();
    await expect(page.getByRole('heading', { name: 'اختر مقاعدك' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'نساء فقط' })).toBeChecked();
    // Der Grundriss bleibt links-nach-rechts, auch auf Arabisch.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.locator('[dir="ltr"]').filter({ has: page.getByRole('checkbox') }),
    ).toHaveCount(1);

    // Kontingent des Seeds: Reihen 9 und 10 verkauft der Schalter, 9A ist gesperrt.
    await expect(page.getByRole('checkbox', { name: 'المقعد 9A، غير متاح' })).toBeDisabled();
    await expect(
      page.getByRole('checkbox', { name: /^المقعد 10B، يباع في شباك التذاكر/ }),
    ).toBeDisabled();
    // Die Hinterbank ist eine Reihe mit fünf Sitzen.
    await expect(
      page.getByRole('group', { name: 'المقعد الخلفي' }).getByRole('checkbox'),
    ).toHaveCount(5);

    await page.getByText('1C', { exact: true }).click();
    await page.getByText('11C', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'المقعد 1C، مختار' })).toBeChecked();
    // Zwei Fahrgäste, zwei Sitze: weitere freie Sitze sind gesperrt, bis einer abgewählt wird.
    await expect(page.getByRole('checkbox', { name: 'المقعد 1D، متاح' })).toBeDisabled();
    await expect(page.getByText('المقاعد: 1C، 11C')).toBeVisible();
    await expect(page.getByText(/المجموع: .*1,200/)).toBeVisible();
    // Beide Sitze gewählt: „Weiter" führt zu den Fahrgastdaten (booking-flow.web.spec.ts).
    await expect(page.getByRole('button', { name: 'متابعة' })).toBeEnabled();

    await page.getByText('1C', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'المقعد 1D، متاح' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'متابعة' })).toBeDisabled();
    await expect(page.getByText('اختر مقعداً واحداً آخر.')).toBeVisible();

    // Das Geschlecht steht nie in einer URL des Browsers (ADR 0019).
    expect(page.url()).not.toMatch(/gender|FEMALE|MALE/i);
    expect(urls.filter((url) => /gender|FEMALE|MALE/i.test(url))).toEqual([]);
  });

  test('zeigt einen Leerzustand, wenn es keine Fahrt gibt', async ({ page }) => {
    await page.goto('/ar');
    const selects = page.locator('form select');
    await selects.nth(0).selectOption({ label: 'حلب' });
    await selects.nth(1).selectOption({ label: 'دمشق' });
    await page.getByRole('button', { name: 'ابحث عن رحلات' }).click();
    await expect(page.getByRole('heading', { name: 'لا توجد رحلات في هذا اليوم' })).toBeVisible();
  });

  test('erklärt eine ungültige Fahrt mit einem Text aus dem Fehlercode', async ({ page }) => {
    const unknown = '019a0000-0000-7000-8000-000000000000';
    await page.goto(`/ar/trips/${unknown}?from=${unknown}&to=${unknown}&passengers=1`);
    await expect(page.getByRole('alert').filter({ hasText: 'لم نجد هذه الرحلة.' })).toBeVisible();
  });
});

test.describe('englisch', () => {
  test.use({ locale: 'en-US' });

  test('sucht für eine Person, behält die Suche beim Sprachwechsel und wählt einen Sitz', async ({
    page,
  }) => {
    const urls = watchUrls(page);
    await page.goto('/en');
    await search(page, 'en', '1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Damascus to Aleppo');
    const trips = page.getByRole('list', { name: 'Trips found' }).getByRole('link');
    await expect(trips.first()).toContainText('SYP');
    await expect(trips.first()).toContainText('9+ seats left');

    // Sprachwechsel behält Städte, Tag und Anzahl.
    const query = new URL(page.url()).search;
    await page.getByRole('link', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(new URL(page.url()).pathname).toBe('/ar/search');
    expect(new URL(page.url()).search).toBe(query);
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.getByRole('list', { name: 'Trips found' }).getByRole('link').nth(1).click();
    // Eine Person: nur Frau oder Mann, keine gemischte Gruppe.
    await expect(page.getByRole('radio')).toHaveCount(2);
    await page.getByText('A man', { exact: true }).click();
    await page.getByText('5A', { exact: true }).click();
    await expect(page.getByText('1 of 1 seats chosen.')).toBeVisible();
    await expect(page.getByText('Seats: 5A')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await expect(page.getByText('Next, you enter the passenger details.')).toBeVisible();
    expect(urls.filter((url) => /gender|FEMALE|MALE/i.test(url))).toEqual([]);
  });
});

test('Suche und Sitzplan tragen eine CSP mit Nonce', async ({ page }) => {
  const response = await page.goto('/en');
  const policy = response?.headers()['content-security-policy'] ?? '';
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  const scriptNonces = await page
    .locator('script')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);
});
