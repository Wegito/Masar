import { expect, test } from '@playwright/test';

import {
  bookingFromUrl,
  cancelAsPassenger,
  chooseSeats,
  expectCleanUrls,
  fillPassengerDetails,
  freePair,
  holdViaApi,
  randomPhone,
  RULE_TEXT_AR,
  RULE_TEXT_EN,
  searchAndOpenTrip,
  seedDemo,
  seedTrip,
  watchUrls,
} from '../support/flow';

/**
 * Geschlechtsregel im Sitzplan je Fahrgast (ADR 0006, 0034): Eine fremde Frau hält einen Sitz,
 * danach ist der Nachbarsitz für einen Mann gesperrt und nicht wählbar, für eine Frau frei. Ein Paar
 * in einer Buchung darf nebeneinander sitzen. Die Regel wird nirgends erklärt, und das Geschlecht
 * steht in keiner URL. Gebucht wird in fünf und sechs Tagen (eigene Abfahrten); am Ende storniert
 * der Test alle Buchungen.
 */

const created: { id: string; manageToken: string }[] = [];

test.beforeAll(() => {
  seedDemo();
});

test.afterAll(async ({ request }) => {
  for (const booking of created.splice(0)) {
    await cancelAsPassenger(request, booking);
  }
});

test.describe('arabisch', () => {
  test.use({ locale: 'ar-SY' });

  test('sperrt einem Mann den Sitz neben einer fremden Frau, ohne die Regel zu erklären', async ({
    page,
    request,
  }) => {
    const trip = await seedTrip(request, 5, 0);
    const [hers, next] = await freePair(request, trip);
    created.push(await holdViaApi(request, trip, hers, 'FEMALE'));
    const phone = randomPhone();
    const urls = watchUrls(page);

    await searchAndOpenTrip(page, 'ar', { days: 5, passengers: 1, index: 0 });
    expect(await page.locator('main').innerText()).not.toMatch(RULE_TEXT_AR);
    await fillPassengerDetails(page, 'ar', [{ name: 'عمر منصور', gender: 'MALE' }], phone.local);

    // Für den Mann: der Sitz der Frau belegt, der Nachbarsitz einfach „غير متاح", ohne Grund.
    await expect(
      page.getByRole('checkbox', { name: `المقعد ${hers.label}، محجوز` }),
    ).toBeDisabled();
    const neighbour = page.getByRole('checkbox', { name: `المقعد ${next.label}، غير متاح` });
    await expect(neighbour).toBeDisabled();
    await page.getByText(next.label, { exact: true }).click({ force: true });
    await expect(neighbour).not.toBeChecked();
    await expect(page.getByText(/^اخترت 0 من 1 مقاعد\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'احجز المقاعد مؤقتاً' })).toBeDisabled();
    expect(await page.locator('main').innerText()).not.toMatch(RULE_TEXT_AR);

    // Dieselbe Seite für eine Frau: Der Nachbarsitz ist frei und wählbar.
    await page.getByRole('button', { name: 'تعديل بيانات الركاب' }).click();
    await page.getByText('امرأة', { exact: true }).click();
    await page.getByRole('button', { name: 'متابعة إلى اختيار المقاعد' }).click();
    await expect(page.getByRole('checkbox', { name: `المقعد ${next.label}، متاح` })).toBeEnabled();

    expectCleanUrls(urls, { phoneDigits: phone.digits, names: ['عمر منصور'] });
  });
});

test.describe('englisch', () => {
  test.use({ locale: 'en-US' });

  test('rechnet den Plan je Fahrgast und lässt ein Paar nebeneinander sitzen', async ({
    page,
    request,
  }) => {
    const trip = await seedTrip(request, 6, 0);
    const [stranger, besideStranger] = await freePair(request, trip);
    created.push(await holdViaApi(request, trip, stranger, 'FEMALE'));
    const [herSeat, hisSeat] = await freePair(request, trip);
    const phone = randomPhone();
    const names = ['Lina Haddad', 'Omar Haddad'];
    const urls = watchUrls(page);

    await searchAndOpenTrip(page, 'en', { days: 6, passengers: 2, index: 0 });
    expect(await page.locator('main').innerText()).not.toMatch(RULE_TEXT_EN);
    await fillPassengerDetails(
      page,
      'en',
      [
        { name: names[0] ?? '', gender: 'FEMALE' },
        { name: names[1] ?? '', gender: 'MALE' },
      ],
      phone.local,
    );

    // Fahrgast 1 (Frau): Der Sitz neben der fremden Frau ist frei.
    await expect(page.getByRole('radio', { name: /Lina Haddad/ })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: `Seat ${besideStranger.label}, free` }),
    ).toBeEnabled();
    // Fahrgast 2 (Mann): derselbe Sitz ist nicht wählbar.
    await page.getByText('Omar Haddad', { exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: `Seat ${besideStranger.label}, not available` }),
    ).toBeDisabled();
    expect(await page.locator('main').innerText()).not.toMatch(RULE_TEXT_EN);

    // Das Paar sitzt nebeneinander: zuerst er, dann sie, der Plan springt selbst weiter.
    await chooseSeats(page, [hisSeat.label]);
    await expect(page.getByRole('radio', { name: /Lina Haddad/ })).toBeChecked();
    await chooseSeats(page, [herSeat.label]);
    await expect(page.getByText(`Lina Haddad: seat ${herSeat.label}`)).toBeVisible();
    await expect(page.getByText(`Omar Haddad: seat ${hisSeat.label}`)).toBeVisible();
    await page.getByRole('button', { name: 'Hold seats' }).click();

    await expect(page).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}\/pay#token=/);
    const booking = bookingFromUrl(page.url());
    created.push(booking);
    await expect(page.getByText(`Seat ${herSeat.label}: Lina Haddad`)).toBeVisible();
    await expect(page.getByText(`Seat ${hisSeat.label}: Omar Haddad`)).toBeVisible();

    expectCleanUrls(urls, { token: booking.manageToken, phoneDigits: phone.digits, names });
  });
});
