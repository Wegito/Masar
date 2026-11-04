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

/** Beschriftungen und IDs freier Sitze für dieses Geschlecht, wie der Sitzplan sie zeigt. */
export async function freeSeats(
  request: APIRequestContext,
  trip: SeedTrip,
  gender: 'FEMALE' | 'MALE',
  count: number,
): Promise<{ seatId: string; label: string }[]> {
  const seatMap = await json<{ seats: { seatId: string; label: string; state: string }[] }>(
    await request.get(`${API_URL}/api/v1/trips/${trip.tripId}/seat-map`, {
      params: { fromStopId: trip.fromStopId, toStopId: trip.toStopId, gender },
    }),
  );
  // Ohne Hinterbank: deren Sitze stehen dicht, die Auswahl soll eindeutig klickbar sein.
  const free = seatMap.seats
    .filter((seat) => seat.state === 'FREE' && !seat.label.startsWith('11'))
    .slice(0, count);
  if (free.length < count) throw new Error('Zu wenige freie Sitze; Testdatenbank neu aufsetzen');
  return free.map(({ seatId, label }) => ({ seatId, label }));
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
