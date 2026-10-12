import { execFileSync } from 'node:child_process';

import { expect, type Page, test } from '@playwright/test';

import { API_DIR, PORTAL_URL, TEST_DATABASE_URL } from '../support/env';

const PASSWORD = 'e2e-passwort-portal-2026'; // gitleaks:allow (Testwert)

/** Erste Plattform-Admin-Person über das echte Skript; liefert den Link zum Setzen des Passworts. */
function createPlatformAdmin(email: string): string {
  const output = execFileSync(
    'node',
    ['dist/scripts/create-platform-admin.js', '--email', email, '--name', 'E2E'],
    {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PORTAL_URL },
      encoding: 'utf8',
    },
  );
  const link = /http\S+#token=\S+/.exec(output)?.[0];
  if (link === undefined) {
    throw new Error('Kein Link in der Ausgabe des Skripts');
  }
  return link;
}

/** Sammelt Verstöße gegen die Content-Security-Policy, die der Browser in der Konsole meldet. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

test('Einstieg: Passwort per Link setzen, anmelden, Sprache wechseln, abmelden', async ({
  page,
}) => {
  const violations = watchCsp(page);
  const email = `e2e-${Date.now()}@masar.example`;
  await page.goto(createPlatformAdmin(email));

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByLabel('كلمة المرور الجديدة').fill(PASSWORD);
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
  await expect(page.getByRole('status')).toContainText('تم حفظ كلمة المرور');

  await page.getByRole('link', { name: 'إلى تسجيل الدخول' }).click();
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
  await expect(page.getByText('مدير المنصة')).toBeVisible();

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/auth\/login$/);

  expect(violations).toEqual([]);
});

test('falsches Passwort zeigt eine verständliche Meldung statt eines Codes', async ({ page }) => {
  await page.goto('/en/auth/login');
  await page.getByLabel('Email').fill('niemand@masar.example');
  await page.getByLabel('Password', { exact: true }).fill('falsches-passwort-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Next.js hat einen eigenen, leeren Ansagebereich mit role=alert; daher nach Text eingrenzen.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' }),
  ).toBeVisible();
});

test('jede Seite trägt eine CSP mit eigenem Nonce, und Next-Skripte tragen ihn', async ({
  page,
}) => {
  const first = await page.goto('/ar/auth/login');
  const policy = first?.headers()['content-security-policy'] ?? '';
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(policy).toContain("frame-ancestors 'none'");
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  const scriptNonces = await page
    .locator('script')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);

  const second = await page.goto('/ar/auth/login');
  expect(second?.headers()['content-security-policy']).not.toBe(policy);
});

test('meldet unbehandelte Fehler an die API, ohne Query und Fragment', async ({ page }) => {
  await page.goto('/en/auth/reset-password?from=mail#token=geheim-123');
  const reported = page.waitForRequest((request) =>
    request.url().endsWith('/api/v1/client-errors'),
  );
  await page.evaluate(() => {
    void Promise.reject(new Error('E2E: abgelehntes Promise'));
  });
  const request = await reported;
  expect(request.postDataJSON()).toMatchObject({
    app: 'portal',
    kind: 'unhandledrejection',
    message: 'E2E: abgelehntes Promise',
    path: '/en/auth/reset-password',
  });
  expect(request.postData()).not.toMatch(/geheim|from=mail/);
  // 204 heißt auch: CSP (connect-src) und CSRF-Prüfung der API lassen den Bericht durch.
  expect((await request.response())?.status()).toBe(204);
});

test('arabische Teile auf englischen Seiten nutzen die arabische Schrift', async ({ page }) => {
  await page.goto('/en/auth/login');
  const first = (value: string): string => value.split(',')[0]?.replace(/['"]/g, '').trim() ?? '';
  const arabicFont = first(
    await page
      .locator('html')
      .evaluate((html) => getComputedStyle(html).getPropertyValue('--font-arabic')),
  );
  for (const part of [
    page.getByRole('link', { name: 'العربية' }),
    page.getByText('مسار', { exact: true }),
  ]) {
    expect(first(await part.evaluate((element) => getComputedStyle(element).fontFamily))).toBe(
      arabicFont,
    );
  }
});
