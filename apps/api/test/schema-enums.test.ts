import { COMPANY_ROLES, LOCALES } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import { CompanyRole, Locale } from '../src/generated/prisma/enums.js';

/** Datenbank-Enums und die Werte im gemeinsamen Paket müssen übereinstimmen (Web nutzt die zweiten). */
describe('Enums in Datenbankschema und gemeinsamem Paket', () => {
  it.each([
    ['CompanyRole', Object.values(CompanyRole), COMPANY_ROLES],
    ['Locale', Object.values(Locale), LOCALES],
  ])('%s stimmt überein', (_name, database, shared) => {
    expect([...database].sort()).toEqual([...shared].sort());
  });
});
