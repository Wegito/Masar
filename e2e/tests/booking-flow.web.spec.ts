import { expect, type Page, test } from '@playwright/test';

import {
  ARABIC_INDIC_DIGIT,
  bookingFromUrl,
  cancelAsPassenger,
  damascusTime,
  freeSeats,
  holdViaApi,
  randomPhone,
  searchAndOpenTrip,
  seedDemo,
  seedTrip,
  watchUrls,
} from '../support/flow';

/**
 * Buchungsablauf in der Web-App (Schritt 1.5): Suche → Sitzwahl → Fahrgastdaten → Hold →
 * Barreservierung → Ticketseite, auf Arabisch und Englisch, dazu der Fehlerpfad „Sitz inzwischen
 * vergeben". Gebucht wird übermorgen (Index 2 der Datumsauswahl), je Test eine andere Abfahrt; am
 * Ende storniert der Test seine Buchungen mit dem Verwaltungstoken aus dem Fragment.
 */

const DAYS = 2;
const created: { id: string; manageToken: string }[] = [];

test.beforeAll(() => {
  seedDemo();
});

test.afterAll(async ({ request }) => {
  for (const booking of created.splice(0)) {
    await cancelAsPassenger(request, booking);
  }
});

/** Weder Token noch Telefon, Name oder Geschlecht stehen in einer angefragten URL. */
function expectCleanUrls(
  urls: string[],
  secrets: { token?: string; phoneDigits: string; names: string[] },
): void {
  for (const requested of urls) {
    expect(requested).not.toMatch(/gender|FEMALE|MALE/i);
    expect(requested).not.toContain(secrets.phoneDigits);
    if (secrets.token !== undefined) expect(requested).not.toContain(secrets.token);
    for (const name of secrets.names) {
      expect(decodeURIComponent(requested)).not.toContain(name);
      expect(requested).not.toContain(encodeURIComponent(name));
    }
    expect(requested).not.toContain('#');
  }
}

async function chooseSeats(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByText(label, { exact: true }).click();
  }
}

test.describe('arabisch', () => {
  test.use({ locale: 'ar-SY' });

  test('bucht zwei Frauen bis zur Barreservierung und zeigt das Ticket mit Barfrist', async ({
    page,
    request,
  }) => {
    const trip = await seedTrip(request, DAYS, 0);
    const seats = await freeSeats(request, trip, 'FEMALE', 2);
    const labels = seats.map((seat) => seat.label);
    const phone = randomPhone();
    const names = ['لينا حداد', 'رنا حداد'];
    const urls = watchUrls(page);

    await searchAndOpenTrip(page, 'ar', { days: DAYS, passengers: 2, index: 0 });
    await page.getByText('نساء فقط').click();
    await expect(page.getByRole('heading', { name: 'اختر مقاعدك' })).toBeVisible();
    const next = page.getByRole('button', { name: 'متابعة' });
    await expect(next).toBeDisabled();
    await expect(page.getByText('اختر مقعدين آخرين.')).toBeVisible();
    await chooseSeats(page, labels);
    await expect(page.getByText('بعد ذلك تُدخل بيانات الركاب.')).toBeVisible();
    await next.click();

    // Fahrgastdaten: je Fahrgast Name und Geschlecht (vorbelegt aus „نساء فقط"), dann Kontakt.
    await expect(page.getByRole('heading', { name: 'بيانات الركاب' })).toBeFocused();
    await expect(page.getByRole('group', { name: `الراكب 1 · المقعد ${labels[0]}` })).toBeVisible();
    await expect(page.getByLabel('الرقم الوطني')).toHaveCount(0);
    const nameFields = page.getByLabel('الاسم الكامل');
    await expect(nameFields).toHaveCount(2);
    await nameFields.nth(0).fill(names[0] ?? '');
    await nameFields.nth(1).fill(names[1] ?? '');
    await expect(page.getByRole('radio', { name: 'امرأة' })).toHaveCount(2);
    for (const radio of await page.getByRole('radio', { name: 'امرأة' }).all()) {
      await expect(radio).toBeChecked();
    }
    await page.getByLabel('رقم الجوال').fill(phone.local);
    await expect(page.getByRole('radio', { name: 'العربية' })).toBeChecked();
    await expect(page.getByText(/المجموع: .*1,200/)).toBeVisible();
    await page.getByRole('button', { name: 'احجز المقاعد مؤقتاً' }).click();

    // Zahlweg: Token nur im Fragment, Restzeit des Holds, nur Barzahlung.
    await expect(page).toHaveURL(/\/ar\/bookings\/[0-9a-f-]{36}\/pay#token=[A-Za-z0-9_-]{22}$/);
    const booking = bookingFromUrl(page.url());
    created.push(booking);
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اختر طريقة الدفع');
    await expect(page.getByRole('timer')).toHaveText(/^\d{1,2}:\d{2}$/);
    await expect(page.getByText(`المقعد ${labels[0] ?? ''}: ${names[0] ?? ''}`)).toBeVisible();
    await expect(page.getByText(damascusTime(trip.departureAt)).first()).toBeVisible();
    await page.getByRole('button', { name: 'احجز وادفع نقداً' }).click();

    // Ticketseite mit demselben Token im Fragment: reserviert, Barfrist mit Uhrzeit in Damaskus.
    await expect(page).toHaveURL(
      new RegExp(`/ar/bookings/${booking.id}#token=${booking.manageToken}$`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تذكرتك');
    await expect(page.getByText('محجوز، الدفع نقداً', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/^الحجز بانتظار الدفع نقداً\. ادفع .+ قبل الساعة \d{2}:\d{2} يوم /),
    ).toBeVisible();
    await expect(page.getByText(names[1] ?? '')).toBeVisible();
    await expect(page.getByRole('img', { name: /^رمز الاستجابة السريعة/ })).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toMatch(ARABIC_INDIC_DIGIT);

    expectCleanUrls(urls, { token: booking.manageToken, phoneDigits: phone.digits, names });
  });
});

test.describe('englisch', () => {
  test.use({ locale: 'en-US' });

  test('bucht einen Mann, erklärt ein ungültiges Telefon und reserviert bar', async ({
    page,
    request,
  }) => {
    const trip = await seedTrip(request, DAYS, 1);
    const [seat] = await freeSeats(request, trip, 'MALE', 1);
    const phone = randomPhone();
    const name = 'Omar Haddad';
    const urls = watchUrls(page);

    await searchAndOpenTrip(page, 'en', { days: DAYS, passengers: 1, index: 1 });
    await page.getByText('A man', { exact: true }).click();
    await chooseSeats(page, [seat?.label ?? '']);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Passenger details' })).toBeVisible();
    await page.getByLabel('Full name').fill(name);
    await expect(page.getByRole('radio', { name: 'Man', exact: true })).toBeChecked();
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByLabel('Email (optional)').fill('omar@example.com');
    await page.getByRole('radio', { name: 'English' }).check();
    await page.getByRole('button', { name: 'Hold seats' }).click();

    // Feldfehler in der Sprache der Seite; die Eingaben bleiben stehen.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Please check the marked fields.' }),
    ).toBeVisible();
    const phoneField = page.getByLabel('Mobile number');
    await expect(phoneField).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByText('Please enter a valid phone number, for example 0933 123 456.'),
    ).toBeVisible();
    await expect(page.getByLabel('Full name')).toHaveValue(name);

    // Internationale Schreibweise; die Server Action normalisiert auf E.164.
    await phoneField.fill(`+963 ${phone.local.slice(1)}`);
    await page.getByRole('button', { name: 'Hold seats' }).click();
    await expect(page).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}\/pay#token=/);
    const booking = bookingFromUrl(page.url());
    created.push(booking);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose how to pay');
    await expect(
      page.getByText(/^Your seats are held for \d{1,2}:\d{2} min more, until \d{2}:\d{2}\.$/),
    ).toBeVisible();
    await expect(page.getByText('Cash at the ticket counter')).toBeVisible();
    await page.getByRole('button', { name: 'Reserve and pay in cash' }).click();

    await expect(page).toHaveURL(new RegExp(`/en/bookings/${booking.id}#token=`));
    await expect(page.getByText('Reserved, pay in cash', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/^Reserved for cash payment\. Pay .+ before \d{2}:\d{2} on /),
    ).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(`Seat ${seat?.label ?? ''}`)).toBeVisible();

    // Neuladen der Seite „Zahlweg wählen" führt jetzt direkt zum Ticket.
    await page.goto(`/en/bookings/${booking.id}/pay#token=${booking.manageToken}`);
    await expect(page).toHaveURL(new RegExp(`/en/bookings/${booking.id}#token=`));
    await expect(page.getByText('Reserved, pay in cash', { exact: true })).toBeVisible();

    expectCleanUrls(urls, { token: booking.manageToken, phoneDigits: phone.digits, names: [name] });
  });

  test('führt bei einem inzwischen vergebenen Sitz zurück zur Sitzwahl und behält die Eingaben', async ({
    page,
    request,
  }) => {
    const trip = await seedTrip(request, DAYS, 2);
    const [taken, other] = await freeSeats(request, trip, 'FEMALE', 2);
    if (taken === undefined || other === undefined) throw new Error('Keine Sitze');
    const name = 'Lina Haddad';

    await searchAndOpenTrip(page, 'en', { days: DAYS, passengers: 1, index: 2 });
    await page.getByText('A woman', { exact: true }).click();
    await chooseSeats(page, [taken.label]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Mobile number').fill(randomPhone().local);

    // Jemand anderes hält genau diesen Sitz, während der Fahrgast tippt.
    created.push(await holdViaApi(request, trip, taken, 'FEMALE'));
    await page.getByRole('button', { name: 'Hold seats' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Someone else' });
    await expect(alert).toContainText(
      `Someone else has just booked these seats: ${taken.label}. Please choose other seats.`,
    );
    await alert.getByRole('button', { name: 'Choose other seats' }).click();

    // Der Sitzplan ist neu geladen: Der Sitz ist belegt, die Auswahl leer, der Hinweis bleibt.
    await expect(page.getByRole('heading', { name: 'Choose your seats' })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Someone else has just booked' }),
    ).toContainText(taken.label);
    await expect(page.getByRole('checkbox', { name: `Seat ${taken.label}, taken` })).toBeDisabled();
    await expect(page.getByText('0 of 1 seats chosen.')).toBeVisible();

    await chooseSeats(page, [other.label]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('group', { name: `Passenger 1 · seat ${other.label}` }),
    ).toBeVisible();
    await expect(page.getByLabel('Full name')).toHaveValue(name);
  });
});
