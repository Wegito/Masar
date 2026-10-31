import { COMPANY_ROLES, GENDERS, LOCALES, TRIP_STATUSES } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  CompanyRole,
  Gender,
  Locale,
  SeatLayoutPattern,
  SeatSide,
  TripStatus,
} from '../src/generated/prisma/enums.js';
import { GENERATED_LAYOUT_PATTERNS, SEAT_SIDES } from '../src/modules/fleet/domain/seat-layout.js';

/**
 * Datenbank-Enums und die Werte im gemeinsamen Paket bzw. in der Domäne müssen übereinstimmen.
 * Web und Portal nutzen die Werte aus `@masar/shared`, die reinen Funktionen ihre eigenen.
 */
describe('Enums in Datenbankschema, gemeinsamem Paket und Domäne', () => {
  it.each([
    ['CompanyRole', Object.values(CompanyRole), COMPANY_ROLES],
    ['Locale', Object.values(Locale), LOCALES],
    ['Gender', Object.values(Gender), GENDERS],
    ['TripStatus', Object.values(TripStatus), TRIP_STATUSES],
    ['SeatSide', Object.values(SeatSide), SEAT_SIDES],
  ])('%s stimmt überein', (_name, database, shared) => {
    expect([...database].sort()).toEqual([...shared].sort());
  });

  it('SeatLayoutPattern enthält alle Muster des Generators, dazu CUSTOM', () => {
    expect(Object.values(SeatLayoutPattern).sort()).toEqual(
      [...GENERATED_LAYOUT_PATTERNS, 'CUSTOM'].sort(),
    );
  });
});
