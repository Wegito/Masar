import { Injectable } from '@nestjs/common';

import type { CompanyStatus, LicensePlan, Prisma } from '../../generated/prisma/client.js';
import type { LicensePeriod } from './domain/license-status.js';

type Db = Prisma.TransactionClient;

/** `date`-Spalte aus einem Kalendertag `YYYY-MM-DD` (Prisma speichert Mitternacht UTC). */
function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface StoredLicensePeriod extends LicensePeriod {
  notes: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyRow {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: CompanyStatus;
}

const PERIOD_SELECT = {
  id: true,
  plan: true,
  validFrom: true,
  validUntil: true,
  busPackages: true,
  notes: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPeriod(row: {
  id: string;
  plan: LicensePlan;
  validFrom: Date;
  validUntil: Date;
  busPackages: number;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredLicensePeriod {
  return { ...row, validFrom: day(row.validFrom), validUntil: day(row.validUntil) };
}

/**
 * Datenbankzugriff des Lizenzstands (Schritt 2.7, ADR 0032). Serialisierungspunkt ist die
 * Firmen-Zeile:
 *
 * - Das Veröffentlichen eines Wochenplans hält sie `FOR SHARE` (vor Strecke, Bus und Sitzplan).
 *   Mehrere Planungen derselben Firma laufen weiter parallel.
 * - Lizenz ändern, Bus anlegen und Bus aktivieren halten sie `FOR NO KEY UPDATE`. Das wartet auf
 *   laufende Planungen und umgekehrt; Fremdschlüssel-Prüfungen (`FOR KEY SHARE`, etwa beim Anlegen
 *   einer Buchung) blockiert es nicht.
 */
@Injectable()
export class LicensesRepository {
  async company(db: Db, companyId: string): Promise<CompanyRow | null> {
    return db.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true, nameAr: true, nameEn: true, status: true },
    });
  }

  async listCompanies(db: Db): Promise<CompanyRow[]> {
    return db.company.findMany({
      select: { id: true, slug: true, nameAr: true, nameEn: true, status: true },
      orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
    });
  }

  /** Sperrt die Firma für eine Planung (geteilt); `false`, wenn es sie nicht gibt. */
  async shareLockCompany(db: Db, companyId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM company WHERE id = ${companyId}::uuid FOR SHARE`;
    return rows.length > 0;
  }

  /** Sperrt die Firma für eine Änderung an Lizenz oder aktiven Bussen. */
  async lockCompanyForChange(db: Db, companyId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM company WHERE id = ${companyId}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  async periods(db: Db, companyId: string): Promise<StoredLicensePeriod[]> {
    const rows = await db.companyLicense.findMany({
      where: { companyId },
      select: PERIOD_SELECT,
      orderBy: [{ validFrom: 'asc' }],
    });
    return rows.map(toPeriod);
  }

  /** Zeiträume aller Firmen für die Übersicht des Plattform-Admins. */
  async periodsByCompany(db: Db): Promise<Map<string, StoredLicensePeriod[]>> {
    const rows = await db.companyLicense.findMany({
      select: { ...PERIOD_SELECT, companyId: true },
      orderBy: [{ companyId: 'asc' }, { validFrom: 'asc' }],
    });
    const result = new Map<string, StoredLicensePeriod[]>();
    for (const { companyId, ...row } of rows) {
      const list = result.get(companyId) ?? [];
      list.push(toPeriod(row));
      result.set(companyId, list);
    }
    return result;
  }

  /** Aktive Busse, die ältesten zuerst; die Busgrenze deckt die ersten `5 × Pakete` ab. */
  async activeBusIds(db: Db, companyId: string): Promise<string[]> {
    const rows = await db.bus.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => row.id);
  }

  async activeBusCounts(db: Db): Promise<Map<string, number>> {
    const rows = await db.bus.groupBy({
      by: ['companyId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.companyId, row._count._all]));
  }

  async insertPeriod(
    db: Db,
    data: {
      companyId: string;
      plan: LicensePlan;
      validFrom: string;
      validUntil: string;
      busPackages: number;
      notes: string | null;
      createdByUserId: string;
    },
  ): Promise<string> {
    const row = await db.companyLicense.create({
      data: {
        ...data,
        validFrom: dateColumn(data.validFrom),
        validUntil: dateColumn(data.validUntil),
      },
      select: { id: true },
    });
    return row.id;
  }

  async updatePeriod(
    db: Db,
    periodId: string,
    data: {
      plan?: LicensePlan;
      validFrom?: string;
      validUntil?: string;
      busPackages?: number;
      notes?: string | null;
    },
  ): Promise<void> {
    await db.companyLicense.update({
      where: { id: periodId },
      data: {
        ...data,
        ...(data.validFrom === undefined ? {} : { validFrom: dateColumn(data.validFrom) }),
        ...(data.validUntil === undefined ? {} : { validUntil: dateColumn(data.validUntil) }),
      },
    });
  }
}
