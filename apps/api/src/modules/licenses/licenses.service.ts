import {
  type LicensePlan,
  type LicensePlanningIssue,
  type LicenseStatus,
  localDateInDamascus,
} from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { CompanyStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { isRetryable, RETRY_AFTER_SECONDS, sqlState } from '../bookings/db-errors.js';
import {
  addCalendarDays,
  defaultValidUntil,
  type LicensePeriod,
  type LicenseStanding,
  licenseStanding,
  planningCheck,
} from './domain/license-status.js';
import type { CreateLicenseInput, UpdateLicenseInput } from './licenses.schemas.js';
import { LicensesRepository, type StoredLicensePeriod } from './licenses.repository.js';

type Tx = Prisma.TransactionClient;

const TX = { maxWait: 5_000, timeout: 10_000 } as const;

export interface LicensePeriodView {
  plan: LicensePlan;
  validFrom: string;
  validUntil: string;
  busPackages: number;
}

/** Lizenzstand, wie ihn die Firma sieht (alle Rollen). Keine Preise, keine interne Notiz. */
export interface LicenseView {
  companyId: string;
  /** Stichtag in Damaskus, auf den sich Status und Tage beziehen. */
  today: string;
  status: LicenseStatus;
  plan: LicensePlan | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Ende der lückenlosen Lizenz inklusive bereits eingetragener Verlängerungen. */
  coveredUntil: string | null;
  daysUntilExpiry: number | null;
  graceEndsOn: string | null;
  planningAllowed: boolean;
  busPackages: number;
  allowedBuses: number;
  activeBuses: number;
  /** Aktive Busse ohne Abdeckung (die jüngsten); mit ihnen plant die Firma keine neuen Fahrten. */
  busesOverLimit: number;
  upcoming: LicensePeriodView | null;
  periods: LicensePeriodView[];
}

export interface AdminLicensePeriodView extends LicensePeriodView {
  id: string;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminLicenseView extends Omit<LicenseView, 'periods'> {
  company: { id: string; slug: string; nameAr: string; nameEn: string; status: CompanyStatus };
  /** Zeitraum, auf den sich der Stand bezieht (für `PUT` ohne `periodId`). */
  periodId: string | null;
  periods: AdminLicensePeriodView[];
}

export interface AdminCompanyListItem {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: CompanyStatus;
  license: Pick<
    LicenseView,
    | 'status'
    | 'plan'
    | 'validUntil'
    | 'coveredUntil'
    | 'daysUntilExpiry'
    | 'busPackages'
    | 'allowedBuses'
    | 'activeBuses'
  >;
}

/** Wirkung des Lizenzstands auf einen Wochenplan; Teil der Antwort von Vorschau und Veröffentlichung. */
export interface SchedulePlanningLicense {
  status: LicenseStatus;
  planningAllowed: boolean;
  coveredUntil: string | null;
  daysUntilExpiry: number | null;
  graceEndsOn: string | null;
  allowedBuses: number;
  activeBuses: number;
  busCovered: boolean | null;
  issue: LicensePlanningIssue | null;
}

function periodView(period: LicensePeriod): LicensePeriodView {
  return {
    plan: period.plan,
    validFrom: period.validFrom,
    validUntil: period.validUntil,
    busPackages: period.busPackages,
  };
}

function view(
  companyId: string,
  today: string,
  standing: LicenseStanding,
  periods: readonly LicensePeriod[],
  activeBuses: number,
): LicenseView {
  return {
    companyId,
    today,
    status: standing.status,
    plan: standing.period?.plan ?? null,
    validFrom: standing.period?.validFrom ?? null,
    validUntil: standing.period?.validUntil ?? null,
    coveredUntil: standing.coveredUntil,
    daysUntilExpiry: standing.daysUntilExpiry,
    graceEndsOn: standing.graceEndsOn,
    planningAllowed: standing.planningAllowed,
    busPackages: standing.period?.busPackages ?? 0,
    allowedBuses: standing.allowedBuses,
    activeBuses,
    busesOverLimit: Math.max(activeBuses - standing.allowedBuses, 0),
    upcoming: standing.upcoming === null ? null : periodView(standing.upcoming),
    periods: periods.map(periodView),
  };
}

/** `23P01` (EXCLUDE): Der Zeitraum überschneidet sich mit einem anderen der Firma. */
function mapLicenseError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (sqlState(error) === '23P01') {
    return new AppError('LICENSE_PERIOD_OVERLAP', {
      detail: 'The period overlaps another license period of the company.',
    });
  }
  if (isRetryable(error)) {
    return new AppError('SERVICE_UNAVAILABLE', {
      detail: 'The company is busy. Retry shortly.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  return error;
}

/**
 * Lizenzstand je Firma (Schritt 2.7, ADR 0029 und 0032). Lesen für alle Rollen der Firma, Pflege
 * nur durch den Plattform-Admin. Die Fahrtplanung fragt {@link planningLicense} unter ihren
 * Sperren; Buchung, Zahlung, Storno und Schalter fragen die Lizenz nie (Fahrgäste stranden nicht).
 */
@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LicensesRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // --- Lesen -------------------------------------------------------------------------------------

  async get(companyId: string): Promise<LicenseView> {
    const today = this.today();
    const [periods, active] = await Promise.all([
      this.repo.periods(this.prisma, companyId),
      this.repo.activeBusIds(this.prisma, companyId),
    ]);
    return view(companyId, today, licenseStanding(periods, today), periods, active.length);
  }

  async getForAdmin(companyId: string): Promise<AdminLicenseView> {
    const company = await this.repo.company(this.prisma, companyId);
    if (company === null) {
      throw new AppError('NOT_FOUND');
    }
    const today = this.today();
    const [periods, active] = await Promise.all([
      this.repo.periods(this.prisma, companyId),
      this.repo.activeBusIds(this.prisma, companyId),
    ]);
    const standing = licenseStanding(periods, today);
    return {
      ...view(companyId, today, standing, periods, active.length),
      company,
      periodId: standing.period?.id ?? null,
      periods: periods.map((period) => ({
        ...periodView(period),
        id: period.id,
        notes: period.notes,
        createdByUserId: period.createdByUserId,
        createdAt: period.createdAt,
        updatedAt: period.updatedAt,
      })),
    };
  }

  async listCompanies(): Promise<{ items: AdminCompanyListItem[] }> {
    const today = this.today();
    const [companies, periods, buses] = await Promise.all([
      this.repo.listCompanies(this.prisma),
      this.repo.periodsByCompany(this.prisma),
      this.repo.activeBusCounts(this.prisma),
    ]);
    return {
      items: companies.map((company) => {
        const own = periods.get(company.id) ?? [];
        const full = view(
          company.id,
          today,
          licenseStanding(own, today),
          own,
          buses.get(company.id) ?? 0,
        );
        return {
          ...company,
          license: {
            status: full.status,
            plan: full.plan,
            validUntil: full.validUntil,
            coveredUntil: full.coveredUntil,
            daysUntilExpiry: full.daysUntilExpiry,
            busPackages: full.busPackages,
            allowedBuses: full.allowedBuses,
            activeBuses: full.activeBuses,
          },
        };
      }),
    };
  }

  // --- Fahrtplanung ------------------------------------------------------------------------------

  /**
   * Sperrt die Firma für eine Planung (`FOR SHARE`). Muss die erste Sperre der Planung sein
   * (Firma → Strecke → Bus → Sitzplan); eine Änderung der Lizenz oder der aktiven Busse wartet bis
   * zum Ende der Transaktion.
   */
  async lockForPlanning(tx: Tx, companyId: string): Promise<void> {
    await this.repo.shareLockCompany(tx, companyId);
  }

  /** Wirkung der Lizenz auf einen Wochenplan, gelesen in der Transaktion der Planung. */
  async planningLicense(
    tx: Tx,
    companyId: string,
    busId: string | null,
  ): Promise<SchedulePlanningLicense> {
    const today = this.today();
    const [periods, active] = await Promise.all([
      this.repo.periods(tx, companyId),
      this.repo.activeBusIds(tx, companyId),
    ]);
    const standing = licenseStanding(periods, today);
    const check = planningCheck(standing, active, busId);
    return {
      status: standing.status,
      planningAllowed: standing.planningAllowed,
      coveredUntil: standing.coveredUntil,
      daysUntilExpiry: standing.daysUntilExpiry,
      graceEndsOn: standing.graceEndsOn,
      allowedBuses: standing.allowedBuses,
      activeBuses: check.activeBuses,
      busCovered: check.busCovered,
      issue: check.issue,
    };
  }

  /** Sperre für Änderungen an den aktiven Bussen (Flotte: Bus anlegen oder aktivieren). */
  async lockForBusChange(tx: Tx, companyId: string): Promise<void> {
    await this.repo.lockCompanyForChange(tx, companyId);
  }

  // --- Pflege durch den Plattform-Admin -------------------------------------------------------

  /** Neuer Zeitraum: setzen (neuer Plan) oder verlängern (schließt ohne `validFrom` an). */
  async create(
    companyId: string,
    input: CreateLicenseInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<AdminLicenseView> {
    const periodId = await this.run(async (tx) => {
      if (!(await this.repo.lockCompanyForChange(tx, companyId))) {
        throw new AppError('NOT_FOUND');
      }
      const today = this.today();
      const periods = await this.repo.periods(tx, companyId);
      const standing = licenseStanding(periods, today);
      const latest = periods.at(-1);
      const validFrom =
        input.validFrom ??
        (standing.planningAllowed && standing.coveredUntil !== null
          ? addCalendarDays(standing.coveredUntil, 1)
          : today);
      const validUntil = input.validUntil ?? defaultValidUntil(input.plan, validFrom);
      if (validUntil < validFrom) {
        throw new AppError('VALIDATION_FAILED', {
          detail: 'The period ends before it starts.',
          errors: [{ path: 'validUntil', rule: 'custom' }],
        });
      }
      const busPackages = input.busPackages ?? latest?.busPackages ?? 1;
      const id = await this.repo.insertPeriod(tx, {
        companyId,
        plan: input.plan,
        validFrom,
        validUntil,
        busPackages,
        notes: input.notes ?? null,
        createdByUserId: actor.userId,
      });
      await this.record(tx, 'LICENSE_PERIOD_CREATED', companyId, id, actor, context, {
        plan: input.plan,
        validFrom,
        validUntil,
        busPackages,
        previousStatus: standing.status,
      });
      return id;
    });
    this.logger.log({ companyId, periodId }, 'Lizenzzeitraum angelegt');
    return this.getForAdmin(companyId);
  }

  /** Ändert Pakete, Beginn, Ende, Plan oder Notiz eines Zeitraums (Standard: der heute maßgebliche). */
  async update(
    companyId: string,
    input: UpdateLicenseInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<AdminLicenseView> {
    const periodId = await this.run(async (tx) => {
      if (!(await this.repo.lockCompanyForChange(tx, companyId))) {
        throw new AppError('NOT_FOUND');
      }
      const periods = await this.repo.periods(tx, companyId);
      const target: StoredLicensePeriod | undefined =
        input.periodId === undefined
          ? (periods.find((p) => p.id === licenseStanding(periods, this.today()).period?.id) ??
            undefined)
          : periods.find((p) => p.id === input.periodId);
      if (target === undefined) {
        throw new AppError('LICENSE_NOT_FOUND');
      }
      const validFrom = input.validFrom ?? target.validFrom;
      const validUntil = input.validUntil ?? target.validUntil;
      if (validUntil < validFrom) {
        throw new AppError('VALIDATION_FAILED', {
          detail: 'The period ends before it starts.',
          errors: [{ path: 'validUntil', rule: 'custom' }],
        });
      }
      const changes: Prisma.InputJsonObject = {
        ...(input.plan !== undefined && input.plan !== target.plan
          ? { plan: { from: target.plan, to: input.plan } }
          : {}),
        ...(validFrom !== target.validFrom
          ? { validFrom: { from: target.validFrom, to: validFrom } }
          : {}),
        ...(validUntil !== target.validUntil
          ? { validUntil: { from: target.validUntil, to: validUntil } }
          : {}),
        ...(input.busPackages !== undefined && input.busPackages !== target.busPackages
          ? { busPackages: { from: target.busPackages, to: input.busPackages } }
          : {}),
      };
      const notesChanged = input.notes !== undefined && input.notes !== target.notes;
      if (Object.keys(changes).length === 0 && !notesChanged) {
        return target.id;
      }
      await this.repo.updatePeriod(tx, target.id, {
        ...(input.plan === undefined ? {} : { plan: input.plan }),
        ...(input.validFrom === undefined ? {} : { validFrom }),
        ...(input.validUntil === undefined ? {} : { validUntil }),
        ...(input.busPackages === undefined ? {} : { busPackages: input.busPackages }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      });
      // Die Notiz selbst steht nie im Audit-Log, nur dass sie sich geändert hat.
      await this.record(tx, 'LICENSE_PERIOD_UPDATED', companyId, target.id, actor, context, {
        ...changes,
        notesChanged,
      });
      return target.id;
    });
    this.logger.log({ companyId, periodId }, 'Lizenzzeitraum geändert');
    return this.getForAdmin(companyId);
  }

  // --- Bausteine ---------------------------------------------------------------------------------

  private today(): string {
    return localDateInDamascus(this.clock.now());
  }

  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TX);
    } catch (error) {
      throw mapLicenseError(error);
    }
  }

  private async record(
    tx: Tx,
    action: string,
    companyId: string,
    periodId: string,
    actor: AuthContext,
    context: RequestContext,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorType: 'USER',
        actorId: actor.userId,
        companyId,
        entityType: 'company_license',
        entityId: periodId,
        data,
      },
      context,
      tx,
    );
  }
}
