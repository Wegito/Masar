import { GENDERS, type Gender, type Locale, LOCALES, normalizePhone } from '@masar/shared';

import {
  CONTACT_NAME_FIELD,
  EMAIL_FIELD,
  type FieldError,
  passengerField,
  PHONE_FIELD,
} from './booking';
import { MAX_PASSENGERS } from './search';

/**
 * Baut aus den Fahrgastdaten die Bodies für Sitzplan und `POST /bookings` (Schritt 1.5, ADR 0034).
 * Nur auf dem Web-Server (Server Action) aufrufen: Die Telefonprüfung nutzt `normalizePhone` aus
 * `@masar/shared`, dieselbe Funktion wie die API, und sendet die Nummer als E.164. Die Prüfung hier
 * ist die erste Linie für verständliche Feldfehler; verbindlich prüft die API.
 */

export interface BookingRequestBody {
  tripId: string;
  fromStopId: string;
  toStopId: string;
  locale: Locale;
  contact: { name: string; phone: string; email?: string };
  passengers: { seatId: string; fullName: string; gender?: Gender; nationalId?: string }[];
}

export type BookingRequestResult =
  | { ok: true; idempotencyKey: string; body: BookingRequestBody }
  | { ok: false; fields: Record<string, FieldError>; malformed: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Grobe Form; die API prüft die Adresse genauer und meldet `contact.email`. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Wie die API: Unicode-NFC, Leerraum zusammengefasst, 2 bis 100 Zeichen. */
function personName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export interface FormValues {
  get(name: string): string;
  getAll(name: string): string[];
}

/** Liest Textfelder aus `FormData`; Dateien und fehlende Felder ergeben ''. */
export function formValues(form: FormData): FormValues {
  return {
    get: (name) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    },
    getAll: (name) =>
      form.getAll(name).filter((value): value is string => typeof value === 'string'),
  };
}

export interface PassengerDetails {
  locale: Locale;
  contact: { name: string; phone: string; email?: string };
  passengers: { fullName: string; gender?: Gender; nationalId?: string }[];
}

export type PassengerDetailsResult =
  { ok: true; details: PassengerDetails } | { ok: false; fields: Record<string, FieldError> };

/**
 * Prüft die Fahrgastdaten (Namen, Geschlecht, Ausweisnummer, Kontakt) für `count` Fahrgäste. Sie
 * stehen seit ADR 0034 vor der Sitzwahl fest; dieselbe Prüfung läuft vor dem Sitzplan und vor dem
 * Hold. Das Geschlecht ist bei aktiver Regel Pflicht und hat keine Vorbelegung.
 */
export function validatePassengerDetails(
  values: FormValues,
  count: number,
): PassengerDetailsResult {
  const fields: Record<string, FieldError> = {};
  const genderRule = values.get('genderRule') === '1';
  const nationalIdRequired = values.get('nationalIdRequired') === '1';
  const localeValue = values.get('notificationLocale');

  const passengers = Array.from({ length: count }, (_, index) => {
    const fullName = personName(values.get(passengerField(index, 'fullName')));
    if (fullName === '') {
      fields[passengerField(index, 'fullName')] = 'required';
    } else if (fullName.length < 2 || fullName.length > 100) {
      fields[passengerField(index, 'fullName')] = 'invalid';
    }
    const genderValue = values.get(passengerField(index, 'gender'));
    const gender = (GENDERS as readonly string[]).includes(genderValue)
      ? (genderValue as Gender)
      : undefined;
    if (genderRule && gender === undefined) {
      fields[passengerField(index, 'gender')] = 'required';
    }
    const nationalId = values.get(passengerField(index, 'nationalId')).trim();
    if (nationalIdRequired) {
      if (nationalId === '') {
        fields[passengerField(index, 'nationalId')] = 'required';
      } else if (nationalId.length > 64) {
        fields[passengerField(index, 'nationalId')] = 'invalid';
      }
    }
    return {
      fullName,
      ...(gender === undefined ? {} : { gender }),
      // Ohne Pflicht der Firma geht keine Ausweisnummer hinaus (ADR 0016).
      ...(nationalIdRequired && nationalId !== '' ? { nationalId } : {}),
    };
  });

  // Ohne eigenen Namen ist die Kontaktperson der erste Fahrgast.
  const ownContactName = personName(values.get(CONTACT_NAME_FIELD));
  if (ownContactName !== '' && (ownContactName.length < 2 || ownContactName.length > 100)) {
    fields[CONTACT_NAME_FIELD] = 'invalid';
  }
  const contactName = ownContactName === '' ? (passengers[0]?.fullName ?? '') : ownContactName;

  const phoneInput = values.get(PHONE_FIELD);
  const phone = phoneInput.length > 40 ? null : normalizePhone(phoneInput);
  if (phone === null || !phone.ok) {
    fields[PHONE_FIELD] = phone?.ok === false && phone.reason === 'EMPTY' ? 'required' : 'invalid';
  }

  const email = values.get(EMAIL_FIELD).trim();
  if (email !== '' && (email.length > 254 || !EMAIL.test(email))) {
    fields[EMAIL_FIELD] = 'invalid';
  }

  if (Object.keys(fields).length > 0 || phone === null || !phone.ok) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    details: {
      locale: (LOCALES as readonly string[]).includes(localeValue) ? (localeValue as Locale) : 'ar',
      contact: { name: contactName, phone: phone.e164, ...(email === '' ? {} : { email }) },
      passengers,
    },
  };
}

export function buildBookingRequest(values: FormValues): BookingRequestResult {
  const tripId = values.get('tripId');
  const fromStopId = values.get('fromStopId');
  const toStopId = values.get('toStopId');
  const idempotencyKey = values.get('idempotencyKey');
  const seatIds = values.getAll('seatId');

  // Versteckte Felder kommen von der Seite selbst; sind sie kaputt, hilft kein Feldhinweis.
  const malformed =
    !UUID.test(tripId) ||
    !UUID.test(fromStopId) ||
    !UUID.test(toStopId) ||
    !IDEMPOTENCY_KEY.test(idempotencyKey) ||
    seatIds.length < 1 ||
    seatIds.length > MAX_PASSENGERS ||
    !seatIds.every((id) => UUID.test(id)) ||
    new Set(seatIds).size !== seatIds.length;
  if (malformed) {
    return { ok: false, fields: {}, malformed: true };
  }

  // Fahrgast i bekommt den i-ten Sitz: Die Seite schickt die Sitze in der Reihenfolge der
  // Fahrgastdaten (ADR 0034).
  const result = validatePassengerDetails(values, seatIds.length);
  if (!result.ok) {
    return { ok: false, fields: result.fields, malformed: false };
  }
  const { details } = result;
  return {
    ok: true,
    idempotencyKey,
    body: {
      tripId,
      fromStopId,
      toStopId,
      locale: details.locale,
      contact: details.contact,
      passengers: details.passengers.map((passenger, index) => ({
        seatId: seatIds[index]!,
        ...passenger,
      })),
    },
  };
}

export interface SeatMapRequestBody {
  fromStopId: string;
  toStopId: string;
  genders: Gender[];
}

export type SeatMapRequestResult =
  | { ok: true; tripId: string; body: SeatMapRequestBody; genders: (Gender | null)[] }
  | { ok: false; fields: Record<string, FieldError>; malformed: boolean };

/**
 * Prüft die Fahrgastdaten vor der Sitzwahl und baut den Body für `POST /trips/:id/seat-map`
 * (ADR 0034). Die API bekommt nur die Geschlechter der Buchung ohne Doppelte, keine Namen und keine
 * Zuordnung zu Personen. `genders` je Fahrgast bleibt auf dem Web-Server und im Browser.
 */
export function buildSeatMapRequest(values: FormValues): SeatMapRequestResult {
  const tripId = values.get('tripId');
  const fromStopId = values.get('fromStopId');
  const toStopId = values.get('toStopId');
  const count = Number(values.get('passengerCount'));
  if (
    !UUID.test(tripId) ||
    !UUID.test(fromStopId) ||
    !UUID.test(toStopId) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_PASSENGERS
  ) {
    return { ok: false, fields: {}, malformed: true };
  }
  const result = validatePassengerDetails(values, count);
  if (!result.ok) {
    return { ok: false, fields: result.fields, malformed: false };
  }
  const genders = result.details.passengers.map((passenger) => passenger.gender ?? null);
  return {
    ok: true,
    tripId,
    genders,
    body: {
      fromStopId,
      toStopId,
      genders: (GENDERS as readonly Gender[]).filter((gender) => genders.includes(gender)),
    },
  };
}

/** Feldfehler aus `errors[].path` der API, nur für Felder, die das Formular kennt. */
export function fieldsFromApiPaths(
  paths: readonly string[],
  passengerCount: number,
): Record<string, FieldError> {
  const known = new Set<string>([CONTACT_NAME_FIELD, PHONE_FIELD, EMAIL_FIELD]);
  for (let index = 0; index < passengerCount; index += 1) {
    known.add(passengerField(index, 'fullName'));
    known.add(passengerField(index, 'gender'));
    known.add(passengerField(index, 'nationalId'));
  }
  const fields: Record<string, FieldError> = {};
  for (const path of paths) {
    if (known.has(path)) {
      fields[path] = 'invalid';
    }
  }
  return fields;
}
