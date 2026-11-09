import { execSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { API_DIR, API_URL, TEST_DATABASE_URL } from './env';

/**
 * Bausteine für Ende-zu-Ende-Tests des Buchungsablaufs (Schritt 1.5 und 1.6). Die Fahrten legt das
 * Demo-Seed an (Damaskus → Homs → Hama → Aleppo, täglich 07:00, 15:00 und 23:00 für sieben Tage).
 * Jeder Test bucht einen eigenen Tag und eine eigene Abfahrt, damit sich die Tests nicht die Sitze
 * wegnehmen; welche Sitze frei sind, fragt der Test vorher bei der API nach. So bleibt ein Lauf
 * grün, auch wenn ein abgebrochener Lauf Reservierungen hinterlassen hat.
 */

export const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

/**
 * Demo-Seed in der Testdatenbank, auf Wunsch mit Konto (Admin der Demo-Firma) und einem
 * Plattform-Admin ohne Firma (Lizenzpflege, Schritt 2.7); idempotent.
 */
export function seedDemo(
  staff?: { email: string; password: string },
  platformAdmin?: { email: string; password: string },
): void {
  // Als Befehlszeile, damit es auch unter Windows startet (pnpm ist dort ein .cmd-Skript).
  execSync('pnpm run db:seed', {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      ...(staff === undefined
        ? {}
        : { SEED_STAFF_EMAIL: staff.email, SEED_STAFF_PASSWORD: staff.password }),
      ...(platformAdmin === undefined
        ? {}
        : {
            SEED_PLATFORM_ADMIN_EMAIL: platformAdmin.email,
            SEED_PLATFORM_ADMIN_PASSWORD: platformAdmin.password,
          }),
    },
    stdio: 'pipe',
  });
}

/** Kalendertag in Damaskus, `days` Tage nach heute; Index der Datumsauswahl ist `days`. */
export function damascusDay(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(
    new Date(Date.now() + days * 24 * 3_600_000),
  );
}

/** Uhrzeit in Damaskus, 24 Stunden, wie die Oberfläche sie zeigen muss. */
export function damascusTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Damascus',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Jede Buchung eine eigene Nummer, damit das Limit offener Buchungen je Telefon nicht greift. */
export function randomPhone(): { e164: string; local: string; digits: string } {
  const rest = String(randomInt(1_000_000, 9_999_999));
  return {
    e164: `+96393${rest}`,
    local: `093 ${rest.slice(0, 3)} ${rest.slice(3)}`,
    digits: `93${rest}`,
  };
}

/** Sammelt alle URLs, die der Browser anfragt. */
export function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.url()}: ${String(response.status())} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface SeedTrip {
  tripId: string;
  companyId: string;
  departureAt: string;
  fromStopId: string;
  toStopId: string;
}

/** Fahrt Damaskus → Aleppo am Tag `days` mit dem Index in der Ergebnisliste (0 = 07:00). */
export async function seedTrip(
  request: APIRequestContext,
  days: number,
  index: number,
): Promise<SeedTrip> {
  const cities = await json<{ items: { id: string; nameEn: string }[] }>(
    await request.get(`${API_URL}/api/v1/cities`),
  );
  const cityId = (name: string): string => {
    const city = cities.items.find((entry) => entry.nameEn === name);
    if (city === undefined) throw new Error(`Stadt ${name} fehlt im Seed`);
    return city.id;
  };
  const search = await json<{
    items: {
      tripId: string;
      company: { id: string };
      departureAt: string;
      from: { tripStopId: string };
      to: { tripStopId: string };
    }[];
  }>(
    await request.get(`${API_URL}/api/v1/trips/search`, {
      params: { from: cityId('Damascus'), to: cityId('Aleppo'), date: damascusDay(days) },
    }),
  );
  const trip = search.items[index];
  if (trip === undefined) throw new Error('Keine Fahrt im Seed');
  return {
    tripId: trip.tripId,
    companyId: trip.company.id,
    departureAt: trip.departureAt,
    fromStopId: trip.from.tripStopId,
    toStopId: trip.to.tripStopId,
  };
}

export interface SeatMapSeat {
  seatId: string;
  label: string;
  state: string;
  notFor: ('FEMALE' | 'MALE')[];
}

/** Sitzplan der API für eine Buchung mit diesen Geschlechtern (POST mit Body, ADR 0034). */
export async function seatMapFor(
  request: APIRequestContext,
  trip: SeedTrip,
  genders: ('FEMALE' | 'MALE')[],
): Promise<SeatMapSeat[]> {
  const seatMap = await json<{ seats: SeatMapSeat[] }>(
    await request.post(`${API_URL}/api/v1/trips/${trip.tripId}/seat-map`, {
      data: { fromStopId: trip.fromStopId, toStopId: trip.toStopId, genders },
    }),
  );
  return seatMap.seats;
}

/** Beschriftungen und IDs freier Sitze für dieses Geschlecht, wie der Sitzplan sie zeigt. */
export async function freeSeats(
  request: APIRequestContext,
  trip: SeedTrip,
  gender: 'FEMALE' | 'MALE',
  count: number,
): Promise<{ seatId: string; label: string }[]> {
  const seats = await seatMapFor(request, trip, [gender]);
  // Ohne Hinterbank: deren Sitze stehen dicht, die Auswahl soll eindeutig klickbar sein.
  const free = seats
    .filter(
      (seat) =>
        seat.state === 'FREE' && !seat.notFor.includes(gender) && !seat.label.startsWith('11'),
    )
    .slice(0, count);
  if (free.length < count) throw new Error('Zu wenige freie Sitze; Testdatenbank neu aufsetzen');
  return free.map(({ seatId, label }) => ({ seatId, label }));
}

/**
 * Zwei nebeneinander liegende Sitze derselben Reihe (A/B oder C/D), beide frei für alle, deren
 * Reihe sonst leer ist. So beeinflussen frühere Läufe den Test nicht.
 */
export async function freePair(
  request: APIRequestContext,
  trip: SeedTrip,
): Promise<[{ seatId: string; label: string }, { seatId: string; label: string }]> {
  const seats = await seatMapFor(request, trip, ['FEMALE', 'MALE']);
  const byLabel = new Map(seats.map((seat) => [seat.label, seat]));
  const open = (label: string): boolean => {
    const seat = byLabel.get(label);
    return seat !== undefined && seat.state === 'FREE' && seat.notFor.length === 0;
  };
  for (let row = 1; row <= 8; row += 1) {
    for (const [left, right] of [
      ['A', 'B'],
      ['C', 'D'],
    ] as const) {
      const a = `${String(row)}${left}`;
      const b = `${String(row)}${right}`;
      if (open(a) && open(b)) {
        return [
          { seatId: byLabel.get(a)!.seatId, label: a },
          { seatId: byLabel.get(b)!.seatId, label: b },
        ];
      }
    }
  }
  throw new Error('Kein freies Sitzpaar; Testdatenbank neu aufsetzen');
}

/** Hold an der Oberfläche vorbei, etwa um einen Sitz „gleichzeitig" zu vergeben. */
export async function holdViaApi(
  request: APIRequestContext,
  trip: SeedTrip,
  seat: { seatId: string },
  gender: 'FEMALE' | 'MALE',
): Promise<{ id: string; manageToken: string }> {
  const held = await json<{ booking: { id: string }; manageToken: string }>(
    await request.post(`${API_URL}/api/v1/bookings`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        tripId: trip.tripId,
        fromStopId: trip.fromStopId,
        toStopId: trip.toStopId,
        locale: 'en',
        contact: { name: 'Sami Khoury', phone: randomPhone().e164 },
        passengers: [{ seatId: seat.seatId, fullName: 'Sami Khoury', gender }],
      },
    }),
  );
  return { id: held.booking.id, manageToken: held.manageToken };
}

/** Storno durch den Fahrgast mit dem Verwaltungstoken; gibt die Sitze für den nächsten Lauf frei. */
export async function cancelAsPassenger(
  request: APIRequestContext,
  booking: { id: string; manageToken: string },
): Promise<void> {
  const response = await request.post(`${API_URL}/api/v1/bookings/${booking.id}/cancel`, {
    headers: { 'X-Manage-Token': booking.manageToken },
  });
  expect(response.status()).toBe(200);
}

const SEARCH_TEXT = {
  ar: { from: 'دمشق', to: 'حلب', submit: 'ابحث عن رحلات', list: 'الرحلات المتاحة' },
  en: { from: 'Damascus', to: 'Aleppo', submit: 'Search trips', list: 'Trips found' },
} as const;

/** Sucht Damaskus → Aleppo am Tag `days` und öffnet die Fahrt mit dem Index `index`. */
export async function searchAndOpenTrip(
  page: Page,
  locale: 'ar' | 'en',
  options: { days: number; passengers: number; index: number },
): Promise<void> {
  const text = SEARCH_TEXT[locale];
  await page.goto(`/${locale}`);
  const selects = page.locator('form select');
  await selects.nth(0).selectOption({ label: text.from });
  await selects.nth(1).selectOption({ label: text.to });
  await selects.nth(2).selectOption({ index: options.days });
  await selects.nth(3).selectOption(String(options.passengers));
  await page.getByRole('button', { name: text.submit }).click();
  await expect(page).toHaveURL(/\/search\?/);
  await page.getByRole('list', { name: text.list }).getByRole('link').nth(options.index).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/trips/[0-9a-f-]+\\?`));
}

/** Liest Buchungs-ID und Token aus der URL einer Seite mit `#token=` im Fragment. */
export function bookingFromUrl(url: string): { id: string; manageToken: string } {
  const parsed = new URL(url);
  const id = /\/bookings\/([0-9a-f-]{36})/.exec(parsed.pathname)?.[1];
  const manageToken = new URLSearchParams(parsed.hash.slice(1)).get('token');
  if (id === undefined || manageToken === null) throw new Error('Keine Buchung in der URL');
  return { id, manageToken };
}

const DETAILS_TEXT = {
  ar: {
    heading: 'بيانات الركاب',
    passenger: (n: number) => `الراكب ${String(n)}`,
    fullName: 'الاسم الكامل',
    genders: { FEMALE: 'امرأة', MALE: 'رجل' },
    phone: 'رقم الجوال',
    toSeats: 'متابعة إلى اختيار المقاعد',
    seatsHeading: 'اختر مقاعدك',
  },
  en: {
    heading: 'Passenger details',
    passenger: (n: number) => `Passenger ${String(n)}`,
    fullName: 'Full name',
    genders: { FEMALE: 'Woman', MALE: 'Man' },
    phone: 'Mobile number',
    toSeats: 'Continue to seat selection',
    seatsHeading: 'Choose your seats',
  },
} as const;

export interface PassengerInput {
  name: string;
  gender: 'FEMALE' | 'MALE';
}

/**
 * Füllt den ersten Schritt der Fahrt-Seite (ADR 0034): je Fahrgast Name und Geschlecht, dazu die
 * Mobilnummer. Mit `submit` geht es weiter zum Sitzplan.
 */
export async function fillPassengerDetails(
  page: Page,
  locale: 'ar' | 'en',
  passengers: PassengerInput[],
  phone: string,
  options: { submit?: boolean } = {},
): Promise<void> {
  const text = DETAILS_TEXT[locale];
  await expect(page.getByRole('heading', { name: text.heading })).toBeVisible();
  for (const [index, passenger] of passengers.entries()) {
    const group = page.getByRole('group', { name: text.passenger(index + 1), exact: true });
    await group.getByLabel(text.fullName).fill(passenger.name);
    await group.getByText(text.genders[passenger.gender], { exact: true }).click();
  }
  await page.getByLabel(text.phone).fill(phone);
  if (options.submit !== false) {
    await page.getByRole('button', { name: text.toSeats }).click();
    await expect(page.getByRole('heading', { name: text.seatsHeading })).toBeVisible();
  }
}

/** Wählt Sitze über ihre Beschriftung; der Plan springt danach selbst zum nächsten Fahrgast. */
export async function chooseSeats(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByText(label, { exact: true }).click();
  }
}

/**
 * Weder Token noch Telefon, Name oder Geschlecht stehen in einer angefragten URL; das Geschlecht
 * reist nur im Body von Server Action und Sitzplan-Anfrage (ADR 0034).
 */
export function expectCleanUrls(
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

/**
 * Texte, die die Geschlechtsregel erklären oder bewerben. Die Regel wirkt still (ADR 0034):
 * Keiner dieser Texte darf auf den Seiten des Buchungsablaufs stehen.
 */
export const RULE_TEXT_EN =
  /seating rule|next to a (man|woman|passenger)|other gender|not for you|women only|men only|mixed group|I am booking for/i;
export const RULE_TEXT_AR =
  /قاعدة|بجانب|الجنس الآخر|غير مناسب لك|نساء فقط|رجال فقط|مجموعة مختلطة|أحجز لـ/;
