import { describe, expect, it } from 'vitest';

import {
  checkoutStep,
  formatCountdown,
  idempotencyKeyFrom,
  isBookingProblem,
  isSeatProblem,
  passengerField,
  payHref,
  remainingSeconds,
} from './booking';
import {
  buildBookingRequest,
  buildSeatMapRequest,
  fieldsFromApiPaths,
  type FormValues,
} from './booking-request';
import { problemFrom } from './problem';

const TRIP = '019a0000-0000-7000-8000-000000000001';
const FROM = '019a0000-0000-7000-8000-000000000002';
const TO = '019a0000-0000-7000-8000-000000000003';
const SEAT_A = '019a0000-0000-7000-8000-00000000000a';
const SEAT_B = '019a0000-0000-7000-8000-00000000000b';

function values(entries: Record<string, string | string[]>): FormValues {
  return {
    get: (name) => {
      const value = entries[name];
      return typeof value === 'string' ? value : '';
    },
    getAll: (name) => {
      const value = entries[name];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    },
  };
}

function form(extra: Record<string, string | string[]> = {}): FormValues {
  return values({
    tripId: TRIP,
    fromStopId: FROM,
    toStopId: TO,
    idempotencyKey: 'AAAAAAAAAAAAAAAAAAAAAA',
    seatId: [SEAT_A, SEAT_B],
    genderRule: '1',
    nationalIdRequired: '0',
    notificationLocale: 'en',
    'passengers.0.fullName': '  Lina   Haddad ',
    'passengers.0.gender': 'FEMALE',
    'passengers.1.fullName': 'Rana Haddad',
    'passengers.1.gender': 'FEMALE',
    'contact.phone': '0933 123 456',
    'contact.email': '',
    'contact.name': '',
    ...extra,
  });
}

describe('buildBookingRequest', () => {
  it('baut den Body mit E.164, Kontakt aus Fahrgast 1 und ohne leere Felder', () => {
    const result = buildBookingRequest(form());
    expect(result).toEqual({
      ok: true,
      idempotencyKey: 'AAAAAAAAAAAAAAAAAAAAAA',
      body: {
        tripId: TRIP,
        fromStopId: FROM,
        toStopId: TO,
        locale: 'en',
        contact: { name: 'Lina Haddad', phone: '+963933123456' },
        passengers: [
          { seatId: SEAT_A, fullName: 'Lina Haddad', gender: 'FEMALE' },
          { seatId: SEAT_B, fullName: 'Rana Haddad', gender: 'FEMALE' },
        ],
      },
    });
  });

  it('nimmt ostarabische Ziffern und internationale Schreibweise an', () => {
    const arabic = buildBookingRequest(form({ 'contact.phone': '٠٩٣٣ ١٢٣ ٤٥٦' }));
    const international = buildBookingRequest(form({ 'contact.phone': '00963 933 123 456' }));
    expect(arabic.ok && arabic.body.contact.phone).toBe('+963933123456');
    expect(international.ok && international.body.contact.phone).toBe('+963933123456');
  });

  it('meldet Feldfehler für Telefon, Namen, Geschlecht und E-Mail', () => {
    const result = buildBookingRequest(
      form({
        'contact.phone': '12',
        'passengers.0.fullName': 'L',
        'passengers.1.fullName': ' ',
        'passengers.1.gender': '',
        'contact.email': 'keine-adresse',
      }),
    );
    expect(result).toEqual({
      ok: false,
      malformed: false,
      fields: {
        'contact.phone': 'invalid',
        'passengers.0.fullName': 'invalid',
        'passengers.1.fullName': 'required',
        'passengers.1.gender': 'required',
        'contact.email': 'invalid',
      },
    });
    expect(buildBookingRequest(form({ 'contact.phone': '' }))).toMatchObject({
      fields: { 'contact.phone': 'required' },
    });
  });

  it('schickt Geschlecht ohne Regel nur, wenn angegeben, und die Ausweisnummer nur bei Pflicht', () => {
    const withoutRule = buildBookingRequest(
      form({
        genderRule: '0',
        'passengers.0.gender': '',
        'passengers.1.gender': '',
        'passengers.0.nationalId': '123',
      }),
    );
    expect(withoutRule.ok && withoutRule.body.passengers[0]).toEqual({
      seatId: SEAT_A,
      fullName: 'Lina Haddad',
    });

    const required = buildBookingRequest(
      form({ nationalIdRequired: '1', 'passengers.0.nationalId': ' 0101 ' }),
    );
    expect(required).toMatchObject({
      ok: false,
      fields: { 'passengers.1.nationalId': 'required' },
    });
    const complete = buildBookingRequest(
      form({
        nationalIdRequired: '1',
        'passengers.0.nationalId': '0101',
        'passengers.1.nationalId': '0202',
      }),
    );
    expect(complete.ok && complete.body.passengers.map((p) => p.nationalId)).toEqual([
      '0101',
      '0202',
    ]);
  });

  it('nimmt einen eigenen Kontaktnamen und eine gültige E-Mail', () => {
    const result = buildBookingRequest(
      form({ 'contact.name': 'Omar Haddad', 'contact.email': 'omar@example.com' }),
    );
    expect(result.ok && result.body.contact).toEqual({
      name: 'Omar Haddad',
      phone: '+963933123456',
      email: 'omar@example.com',
    });
  });

  it('lehnt kaputte versteckte Felder ab, ohne Feldhinweise', () => {
    const broken: Record<string, string | string[]>[] = [
      { tripId: 'nicht-da' },
      { idempotencyKey: 'kurz' },
      { seatId: [SEAT_A, SEAT_A] },
      { seatId: [] },
      { seatId: Array.from({ length: 10 }, () => SEAT_A) },
    ];
    for (const extra of broken) {
      expect(buildBookingRequest(form(extra))).toEqual({ ok: false, fields: {}, malformed: true });
    }
  });

  it('fällt bei unbekannter Sprache auf Arabisch zurück', () => {
    const result = buildBookingRequest(form({ notificationLocale: 'de' }));
    expect(result.ok && result.body.locale).toBe('ar');
  });
});

describe('buildSeatMapRequest (Fahrgastdaten vor der Sitzwahl, ADR 0034)', () => {
  function details(extra: Record<string, string | string[]> = {}): FormValues {
    return form({ seatId: [], idempotencyKey: '', passengerCount: '2', ...extra });
  }

  it('schickt nur die Geschlechter der Buchung ohne Doppelte und ohne Namen', () => {
    const result = buildSeatMapRequest(details());
    expect(result).toEqual({
      ok: true,
      tripId: TRIP,
      genders: ['FEMALE', 'FEMALE'],
      body: { fromStopId: FROM, toStopId: TO, genders: ['FEMALE'] },
    });
    expect(JSON.stringify(result.ok && result.body)).not.toMatch(/Haddad|933/);
  });

  it('rechnet eine gemischte Gruppe mit beiden Geschlechtern, je Fahrgast in Reihenfolge', () => {
    const result = buildSeatMapRequest(details({ 'passengers.0.gender': 'MALE' }));
    expect(result.ok && result.genders).toEqual(['MALE', 'FEMALE']);
    expect(result.ok && result.body.genders).toEqual(['FEMALE', 'MALE']);
  });

  it('verlangt das Geschlecht je Fahrgast ohne Vorbelegung und prüft alle Felder vorab', () => {
    const result = buildSeatMapRequest(
      details({ 'passengers.1.gender': '', 'contact.phone': '', 'passengers.0.fullName': '' }),
    );
    expect(result).toEqual({
      ok: false,
      malformed: false,
      fields: {
        'passengers.0.fullName': 'required',
        'passengers.1.gender': 'required',
        'contact.phone': 'required',
      },
    });
  });

  it('fragt ohne Geschlechtsregel kein Geschlecht und schickt keines', () => {
    const result = buildSeatMapRequest(
      details({ genderRule: '0', 'passengers.0.gender': '', 'passengers.1.gender': '' }),
    );
    expect(result.ok && result.body.genders).toEqual([]);
    expect(result.ok && result.genders).toEqual([null, null]);
  });

  it('lehnt kaputte versteckte Felder ab', () => {
    const broken: Record<string, string>[] = [
      { passengerCount: '0' },
      { passengerCount: '10' },
      { toStopId: 'x' },
    ];
    for (const extra of broken) {
      expect(buildSeatMapRequest(details(extra))).toEqual({
        ok: false,
        fields: {},
        malformed: true,
      });
    }
  });
});

describe('fieldsFromApiPaths', () => {
  it('übernimmt nur Felder, die das Formular kennt', () => {
    expect(
      fieldsFromApiPaths(
        ['contact.phone', 'passengers.1.fullName', 'passengers.5.fullName', 'x'],
        2,
      ),
    ).toEqual({ 'contact.phone': 'invalid', 'passengers.1.fullName': 'invalid' });
  });
});

describe('problemFrom', () => {
  it('liest Code, Sitzbeschriftungen und Fehlerpfade', () => {
    expect(
      problemFrom(
        {
          code: 'SEAT_TAKEN',
          params: { seats: ['3A', 4, 'X'.repeat(40)] },
          errors: [{ path: 'contact.phone', rule: 'custom' }, { rule: 'x' }],
          detail: 'egal',
        },
        409,
      ),
    ).toEqual({ code: 'SEAT_TAKEN', status: 409, seats: ['3A'], errorPaths: ['contact.phone'] });
    expect(problemFrom('kaputt', 500)).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
  });
});

describe('Helfer für Hold und Zahlweg', () => {
  it('erzeugt einen Idempotency-Key im Format der API', () => {
    const key = idempotencyKeyFrom(new Uint8Array(16).fill(255));
    expect(key).toBe('_____________________w');
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(() => idempotencyKeyFrom(new Uint8Array(8))).toThrow();
  });

  it('legt das Token nur ins Fragment', () => {
    expect(payHref('ar', 'b1', 'tok')).toBe('/ar/bookings/b1/pay#token=tok');
  });

  it('rechnet die Restzeit mit der Uhr des Servers', () => {
    const serverNow = '2026-11-02T10:00:00.000Z';
    // Geräteuhr eine Stunde falsch: Es zählt nur die vergangene Zeit seit dem Laden.
    const loadedAt = Date.parse('2026-11-02T11:00:00.000Z');
    expect(remainingSeconds('2026-11-02T10:10:00.000Z', serverNow, loadedAt, loadedAt)).toBe(600);
    expect(
      remainingSeconds('2026-11-02T10:10:00.000Z', serverNow, loadedAt, loadedAt + 599_500),
    ).toBe(1);
    expect(
      remainingSeconds('2026-11-02T10:10:00.000Z', serverNow, loadedAt, loadedAt + 700_000),
    ).toBe(0);
  });

  it('formatiert den Countdown mit westlichen Ziffern', () => {
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('ordnet jedem Status einen Schritt zu', () => {
    expect(checkoutStep('HELD')).toBe('pay');
    expect(checkoutStep('RESERVED')).toBe('ticket');
    expect(checkoutStep('CONFIRMED')).toBe('ticket');
    expect(checkoutStep('PENDING_CONFIRMATION')).toBe('ticket');
    expect(checkoutStep('EXPIRED')).toBe('expired');
    expect(checkoutStep('CANCELLED')).toBe('cancelled');
  });

  it('erkennt Sitzfehler und Fehler mit eigenem Text', () => {
    expect(isSeatProblem('SEAT_TAKEN')).toBe(true);
    expect(isSeatProblem('GENDER_RULE_CONFLICT')).toBe(true);
    expect(isSeatProblem('TOO_MANY_OPEN_HOLDS')).toBe(false);
    expect(isBookingProblem('TOO_MANY_OPEN_HOLDS')).toBe(true);
    expect(isBookingProblem('RATE_LIMITED')).toBe(false);
    expect(passengerField(2, 'gender')).toBe('passengers.2.gender');
  });
});
