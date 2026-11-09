import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { defaultValidUntil } from '../src/modules/licenses/domain/license-status.js';
import { resetDatabase } from './helpers/app.js';
import { connectRaw, sqlError } from './helpers/inventory.js';

/**
 * Handgeschriebenes SQL der Migration `20261104180000_lizenzstand` (ADR 0004, 0032): EXCLUDE- und
 * CHECK-Constraints, Rechte der Anwendungsrolle und der Trigger für neue Firmen. Alles läuft mit
 * der Anwendungsrolle an der Anwendung vorbei.
 */

describe('Lizenz im Datenbankschema', () => {
  let raw: pg.Client;

  beforeAll(async () => {
    raw = await connectRaw();
  });

  afterAll(async () => {
    await raw.end();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  async function insertCompany(slug: string, createdAt?: string): Promise<string> {
    const result = await raw.query<{ id: string }>(
      `INSERT INTO company (slug, name_ar, name_en, created_at, updated_at)
       VALUES ($1, 'شركة', 'Company', COALESCE($2::timestamptz, now()), now()) RETURNING id`,
      [slug, createdAt ?? null],
    );
    return result.rows[0]!.id;
  }

  async function periods(
    companyId: string,
  ): Promise<{ plan: string; valid_from: string; valid_until: string; bus_packages: number }[]> {
    const result = await raw.query<{
      plan: string;
      valid_from: string;
      valid_until: string;
      bus_packages: number;
    }>(
      `SELECT plan, valid_from::text, valid_until::text, bus_packages
         FROM company_license WHERE company_id = $1 ORDER BY valid_from`,
      [companyId],
    );
    return result.rows;
  }

  it('company_license_no_overlap ist ein EXCLUDE-Constraint über geschlossene Tagesbereiche', async () => {
    const { rows } = await raw.query<{ contype: string; def: string }>(
      `SELECT contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'company_license_no_overlap' AND conrelid = 'company_license'::regclass`,
    );
    expect(rows).toEqual([
      {
        contype: 'x',
        def: "EXCLUDE USING gist (company_id WITH =, daterange(valid_from, valid_until, '[]'::text) WITH &&)",
      },
    ]);
  });

  it('alle CHECK-Constraints, der Trigger und seine Funktion existieren', async () => {
    const checks = await raw.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'company_license'::regclass ORDER BY conname`,
    );
    expect(checks.rows.map((row) => row.name)).toEqual([
      'company_license_bus_packages_positive',
      'company_license_notes_length',
      'company_license_valid_range',
    ]);
    const trigger = await raw.query<{ name: string; fn: string; enabled: string }>(
      `SELECT t.tgname AS name, p.proname AS fn, t.tgenabled AS enabled
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'company'::regclass AND NOT t.tgisinternal`,
    );
    expect(trigger.rows).toEqual([
      { name: 'company_license_founding', fn: 'company_license_founding', enabled: 'O' },
    ]);
  });

  it('eine neue Firma bekommt 6 Monate FOUNDING ab ihrem Anlagetag in Damaskus', async () => {
    // 21:30 UTC ist 00:30 des Folgetags in Damaskus.
    const late = await insertCompany('spaet', '2026-11-04T21:30:00Z');
    expect(await periods(late)).toEqual([
      {
        plan: 'FOUNDING',
        valid_from: '2026-11-05',
        valid_until: defaultValidUntil('FOUNDING', '2026-11-05'),
        bus_packages: 1,
      },
    ]);
    // Monatsende: 31.08. + 6 Monate wird wie in der Domänenfunktion auf den 28.02. gekürzt.
    const endOfMonth = await insertCompany('monatsende', '2026-08-31T09:00:00Z');
    expect(await periods(endOfMonth)).toEqual([
      {
        plan: 'FOUNDING',
        valid_from: '2026-08-31',
        valid_until: defaultValidUntil('FOUNDING', '2026-08-31'),
        bus_packages: 1,
      },
    ]);
    expect(defaultValidUntil('FOUNDING', '2026-08-31')).toBe('2027-02-27');
  });

  it('lehnt überschneidende Zeiträume, falsche Bereiche, null Pakete und lange Notizen ab', async () => {
    const companyId = await insertCompany('regeln', '2026-11-04T09:00:00Z');
    const insert = (from: string, until: string, packages = 1, notes: string | null = null) =>
      raw.query(
        `INSERT INTO company_license (company_id, plan, valid_from, valid_until, bus_packages, notes, updated_at)
         VALUES ($1, 'ONE_YEAR', $2, $3, $4, $5, now())`,
        [companyId, from, until, packages, notes],
      );
    // Der letzte Tag der Gründungsphase ist 2027-05-03; derselbe Tag überschneidet sich.
    expect(await sqlError(insert('2027-05-03', '2028-05-02'))).toEqual({
      code: '23P01',
      constraint: 'company_license_no_overlap',
    });
    await insert('2027-05-04', '2028-05-03');
    expect(await sqlError(insert('2029-01-10', '2029-01-09'))).toMatchObject({
      code: '23514',
      constraint: 'company_license_valid_range',
    });
    expect(await sqlError(insert('2029-01-01', '2029-12-31', 0))).toMatchObject({
      code: '23514',
      constraint: 'company_license_bus_packages_positive',
    });
    expect(await sqlError(insert('2029-01-01', '2029-12-31', 1, 'x'.repeat(201)))).toMatchObject({
      code: '23514',
      constraint: 'company_license_notes_length',
    });
    // Eine andere Firma darf denselben Zeitraum haben.
    const other = await insertCompany('andere', '2026-11-04T09:00:00Z');
    expect((await periods(other)).length).toBe(1);
  });

  it('die Anwendungsrolle darf Zeiträume ändern, aber nicht löschen', async () => {
    const { rows } = await raw.query<{ del: boolean; upd: boolean; ins: boolean }>(
      `SELECT has_table_privilege('masar_app', 'company_license', 'DELETE') AS del,
              has_table_privilege('masar_app', 'company_license', 'UPDATE') AS upd,
              has_table_privilege('masar_app', 'company_license', 'INSERT') AS ins`,
    );
    expect(rows[0]).toEqual({ del: false, upd: true, ins: true });
    const companyId = await insertCompany('loeschen');
    expect(
      await sqlError(raw.query('DELETE FROM company_license WHERE company_id = $1', [companyId])),
    ).toMatchObject({ code: '42501' });
  });
});
