import { expect, type Request, test } from '@playwright/test';

test.describe('arabischer Browser', () => {
  test.use({ locale: 'ar-SY' });

  test('landet auf /ar mit RTL und wechselt auf Englisch', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');

    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Book your coach seat from your phone',
    );
  });
});

test('englischer Browser landet auf /en', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('PWA-Manifest verweist auf echte PNG-Symbole', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { start_url: string; icons: { src: string }[] };
  expect(manifest.start_url).toBe('/ar');
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toBe('image/png');
  }
});

test('meldet Browser-Fehler ohne Query und Fragment, höchstens fünf je Seite', async ({ page }) => {
  const reports: Request[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/client-errors')) {
      reports.push(request);
    }
  });
  await page.goto('/ar?from=damascus#token=geheim');

  // Sieben Fehler, danach eine Markierungsanfrage: Bis sie ankommt, sind alle Berichte abgeschickt.
  const marker = page.waitForRequest((request) => request.url().endsWith('/api/health/live'));
  await page.evaluate(() => {
    for (let i = 1; i <= 7; i += 1) {
      setTimeout(() => {
        throw new Error(`E2E-Fehler ${i}`);
      }, 0);
    }
    setTimeout(() => {
      void fetch('/api/health/live');
    }, 0);
  });
  await marker;

  expect(reports).toHaveLength(5);
  expect(reports[0]?.postDataJSON()).toMatchObject({
    app: 'web',
    kind: 'error',
    message: 'E2E-Fehler 1',
    path: '/ar',
  });
  for (const report of reports) {
    expect(report.postData()).not.toMatch(/damascus|geheim/);
  }
  expect((await reports[0]?.response())?.status()).toBe(204);
});

test('arabische Teile auf englischen Seiten nutzen die arabische Schrift', async ({ page }) => {
  await page.goto('/en');
  const fonts = await page.getByRole('link', { name: 'العربية' }).evaluate((link) => ({
    link: getComputedStyle(link).fontFamily,
    arabic: getComputedStyle(document.documentElement).getPropertyValue('--font-arabic'),
  }));
  // Erste Schrift im Stapel; sonst nimmt der Browser die Ersatzschrift von Inter (lokales Arial).
  const first = (value: string): string => value.split(',')[0]?.replace(/['"]/g, '').trim() ?? '';
  expect(first(fonts.arabic)).not.toBe('');
  expect(first(fonts.link)).toBe(first(fonts.arabic));
});
