import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { PORTAL_URL } from '../support/env';
import { ARABIC_INDIC_DIGIT, damascusDay, seedDemo } from '../support/flow';

/**
 * Lizenzstand im Portal (Schritt 2.7, ADR 0029 und 0032): Der Plattform-Admin findet die
 * Demo-Firma unter „Plattform", ändert das Ende des laufenden Zeitraums im Formular; die Firma
 * sieht den Hinweis im Rahmen und die Seite „Lizenz", aber keinen Admin-Bereich. Danach Kulanz und
 * Ablauf (über die Admin-API): „Woche planen" warnt in der Kulanz und sperrt nach Ablauf das
 * Veröffentlichen. Am Ende stellt der Test den ursprünglichen Zeitraum wieder her; bricht ein Lauf
 * ab, heilt der Seed eine abgelaufene Demo-Lizenz beim nächsten Lauf.
 */

// Beispielwerte wie in docs/demo.md; nur für lokale Demo und Tests, kein Geheimnis.
const STAFF = {
  email: 'demo-admin@masar.invalid',
  password: 'nur-lokale-demo-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};
const PLATFORM = {
  email: 'demo-plattform@masar.invalid',
  password: 'nur-lokale-plattform-2026', // gitleaks:allow (Beispielwert der Demo-Anleitung)
};

const TEXT = {
  ar: {
    login: { email: 'البريد الإلكتروني', password: 'كلمة المرور', submit: 'دخول' },
    nav: 'أقسام البوابة',
    admin: 'المنصة',
    license: 'الرخصة',
    company: 'بولمان مسار التجريبي',
    manage: 'إدارة الرخصة',
    title: 'رخصة بولمان مسار التجريبي',
    validUntil: 'اليوم الأخير (YYYY-MM-DD)',
    save: 'حفظ التغييرات',
    saved: 'تم الحفظ.',
    veryShort: 'تنتهي قريباً جداً',
    founding: 'مرحلة التأسيس (6 أشهر مجاناً)',
    forbidden: 'هذا القسم متاح لمديري المنصة فقط.',
    daysLeft: 'الأيام المتبقية: 5',
    route: 'الخط',
    demoRoute: 'دمشق – حمص – حماة – حلب',
    vehicle: 'الحافلة أو مخطط المقاعد',
    layoutOption: 'مخطط المقاعد فقط: Standard 45 (الإصدار 1)',
    departureTime: 'الانطلاق (بتوقيت دمشق، HH:MM)',
    from: 'اليوم الأول (YYYY-MM-DD)',
    to: 'اليوم الأخير (YYYY-MM-DD)',
    preview: 'عرض المعاينة',
    submit: 'نشر',
    grace: 'فترة سماح الرخصة',
    expired: 'الرخصة منتهية',
  },
  en: {
    login: { email: 'Email', password: 'Password', submit: 'Sign in' },
    nav: 'Portal sections',
    admin: 'Platform',
    license: 'License',
    company: 'Masar Demo Pullman',
    manage: 'Manage license',
    title: 'License of Masar Demo Pullman',
    validUntil: 'Last day (YYYY-MM-DD)',
    save: 'Save changes',
    saved: 'Saved.',
    veryShort: 'Ends very soon',
    founding: 'Founding phase (6 months free)',
    forbidden: 'Only platform administrators can open this area.',
    daysLeft: 'days left: 5',
    route: 'Route',
    demoRoute: 'Damascus – Homs – Hama – Aleppo',
    vehicle: 'Bus or seat layout',
    layoutOption: 'Seat layout only: Standard 45 (version 1)',
    departureTime: 'Departure (Damascus time, HH:MM)',
    from: 'First day (YYYY-MM-DD)',
    to: 'Last day (YYYY-MM-DD)',
    preview: 'Show preview',
    submit: 'Publish',
    grace: 'License grace period',
    expired: 'License expired',
  },
} as const;

test.beforeAll(() => {
  seedDemo(STAFF, PLATFORM);
});

async function login(page: Page, locale: 'ar' | 'en', account: typeof STAFF): Promise<void> {
  const text = TEXT[locale];
  await page.goto(`/${locale}/auth/login`);
  await page.getByLabel(text.login.email).fill(account.email);
  await page.getByLabel(text.login.password, { exact: true }).fill(account.password);
  await page.getByRole('button', { name: text.login.submit }).click();
  await expect(page.getByRole('navigation', { name: text.nav })).toBeVisible();
}

async function putLicense(
  request: APIRequestContext,
  companyId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await request.put(`/api/v1/admin/companies/${companyId}/license`, { data: body });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Formular „Woche planen" mit der Demo-Strecke und nur dem Sitzplan, dann Vorschau. */
async function previewWeek(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const text = TEXT[locale];
  const day = damascusDay(10);
  await page.getByRole('combobox', { name: text.route }).selectOption({ label: text.demoRoute });
  await page
    .getByRole('combobox', { name: text.vehicle })
    .selectOption({ label: text.layoutOption });
  await page.getByRole('textbox', { name: text.departureTime }).fill('04:10');
  await page.getByRole('textbox', { name: text.from }).fill(day);
  await page.getByRole('textbox', { name: text.to, exact: true }).fill(day);
  await page.getByRole('button', { name: text.preview }).click();
}

for (const locale of ['ar', 'en'] as const) {
  const text = TEXT[locale];

  test(`Lizenz (${locale}): pflegen, Hinweis, Seite, Kulanz und Sperre beim Planen`, async ({
    page,
    browser,
  }) => {
    const admin = await browser.newContext({ baseURL: PORTAL_URL });
    const adminPage = await admin.newPage();
    let companyId = '';
    let original: { validFrom: string; validUntil: string } | null = null;
    try {
      // Plattform-Admin: Firmenliste, Lizenz der Demo-Firma, Ende auf heute + 5 setzen.
      await login(adminPage, locale, PLATFORM);
      const nav = adminPage.getByRole('navigation', { name: text.nav });
      await nav.getByRole('link', { name: text.admin }).click();
      await expect(adminPage).toHaveURL(new RegExp(`/${locale}/admin/companies$`));
      await adminPage
        .getByRole('article', { name: text.company })
        .getByRole('link', { name: text.manage })
        .click();
      await expect(adminPage.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
      companyId = /admin\/companies\/([0-9a-f-]+)\/license/.exec(adminPage.url())?.[1] ?? '';
      const before = (await (
        await adminPage.request.get(`/api/v1/admin/companies/${companyId}/license`)
      ).json()) as { validFrom: string; validUntil: string };
      original = { validFrom: before.validFrom, validUntil: before.validUntil };

      await adminPage.getByLabel(text.validUntil, { exact: true }).first().fill(damascusDay(5));
      await adminPage.getByRole('button', { name: text.save }).click();
      await expect(adminPage.getByRole('status').filter({ hasText: text.saved })).toBeVisible();
      await expect(adminPage.getByTestId('license-status')).toHaveText(text.veryShort);

      // Firma: Hinweis im Rahmen, Seite „Lizenz", kein Admin-Bereich.
      await login(page, locale, STAFF);
      const banner = page.getByTestId('license-banner');
      await expect(banner).toHaveAttribute('data-kind', 'expiringVerySoon');
      await expect(banner).toContainText(text.daysLeft);
      await banner.getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/license$`));
      await expect(page.getByRole('heading', { level: 1, name: text.license })).toBeVisible();
      await expect(page.getByTestId('license-status')).toHaveText(text.veryShort);
      await expect(page.locator('main')).toContainText(text.founding);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
      const staffNav = page.getByRole('navigation', { name: text.nav });
      await expect(staffNav.getByRole('link', { name: text.license })).toBeVisible();
      await expect(staffNav.getByRole('link', { name: text.admin })).toHaveCount(0);
      await page.goto(`/${locale}/admin/companies`);
      await expect(page.locator('main')).toContainText(text.forbidden);

      // Kulanz: abgelaufen seit drei Tagen. Planen bleibt möglich, das Formular warnt.
      await putLicense(adminPage.request, companyId, {
        validFrom: damascusDay(-200),
        validUntil: damascusDay(-3),
      });
      await page.goto(`/${locale}/trips`);
      await expect(page.getByTestId('license-banner')).toHaveAttribute('data-kind', 'grace');
      await expect(page.getByTestId('schedule-license')).toContainText(text.grace);
      await previewWeek(page, locale);
      await expect(page.getByTestId('schedule-preview-license')).toHaveAttribute(
        'data-notice',
        'grace',
      );
      await expect(page.getByRole('button', { name: text.submit, exact: true })).toBeEnabled();

      // Nach der Kulanz: Veröffentlichen gesperrt, bestehende Fahrten unberührt.
      await putLicense(adminPage.request, companyId, { validUntil: damascusDay(-20) });
      await page.reload();
      await expect(page.getByTestId('license-banner')).toHaveAttribute('data-kind', 'expired');
      await expect(page.getByTestId('schedule-license')).toContainText(text.expired);
      await previewWeek(page, locale);
      await expect(page.getByTestId('schedule-preview-license')).toHaveAttribute(
        'data-notice',
        'expired',
      );
      await expect(page.getByRole('button', { name: text.submit, exact: true })).toBeDisabled();
      expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);
    } finally {
      if (original !== null && companyId !== '') {
        await putLicense(adminPage.request, companyId, original);
      }
      await admin.close();
    }
  });
}
