import {
  localDateInDamascus,
  type ScheduleItemState,
  TRIP_SCHEDULE_LIMITS,
  type TripStatus,
} from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Prisma, SeatSide } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { tripTransition } from '../bookings/domain/transitions.js';
import { LicensesService, type SchedulePlanningLicense } from '../licenses/licenses.service.js';
import {
  daySpan,
  type ListTripsQuery,
  type ScheduleInput,
  TRIP_LIST_DEFAULT_DAYS,
  type UpdateQuotaInput,
} from './company-trips.schemas.js';
import {
  CompanyTripsRepository,
  type NewTrip,
  type PlanningRouteStop,
  type TripSummaryRow,
} from './company-trips.repository.js';
import { damascusDayRange } from './domain/search-day.js';
import { encodeTripListCursor } from './domain/trip-list-cursor.js';
import {
  classifySchedule,
  datesWithoutFares,
  evenStopOffsets,
  onlineQuota,
  onlineSalesCloseAt,
  planQuotaChange,
  planStopTimes,
  type ScheduleItem,
  scheduleInPast,
  sellableSeatCount,
  stopOffsetsIssue,
} from './domain/trip-planning.js';
import { expandSchedule, type PlannedTrip } from './domain/trip-schedule.js';
import { mapTripsError } from './trips-errors.js';

type Tx = Prisma.TransactionClient;

export interface TripSummaryView {
  id: string;
  status: TripStatus;
  /** Abfahrtstag am Starthalt in Damaskus (ADR 0012). */
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
  onlineSalesCloseAt: Date;
  genderRuleEnabled: boolean;
  route: { id: string; nameAr: string; nameEn: string };
  bus: { id: string; plate: string } | null;
  seatLayout: { id: string; name: string; version: number };
  /** Kontingent: online, Schalter, gesperrt; `occupied` zählt Sitze mit aktiver Belegung. */
  quota: { total: number; online: number; counter: number; blocked: number; occupied: number };
  activeBookings: number;
}

export interface TripStopView {
  id: string;
  seq: number;
  arrivalAt: Date | null;
  departureAt: Date | null;
  station: { id: string; nameAr: string; nameEn: string };
  city: { id: string; nameAr: string; nameEn: string };
}

export interface TripSeatView {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  isSellable: boolean;
  onlineSellable: boolean;
  blocked: boolean;
  occupied: boolean;
}

export interface TripDetailView extends TripSummaryView {
  stops: TripStopView[];
  layout: { rows: number; columns: number };
  seats: TripSeatView[];
}

export interface ScheduleItemView {
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
  /** `NEW` (Vorschau: entsteht; Veröffentlichung: angelegt), `EXISTS` (übersprungen), `BUS_CONFLICT`. */
  state: ScheduleItemState;
  /** Angelegte oder vorhandene Fahrt; in der Vorschau bei `NEW` `null`. */
  tripId: string | null;
  /** Für diesen Fahrtag fehlt mindestens ein Tarif. */
  fareMissing: boolean;
  stops: { seq: number; arrivalAt: Date | null; departureAt: Date | null }[];
}

export interface ScheduleResult {
  routeId: string;
  busId: string | null;
  seatLayoutId: string;
  /** Verkaufbare Sitze des Plans und davon online. */
  seatCount: number;
  onlineSeats: number;
  genderRuleEnabled: boolean;
  onlineSalesCloseMinutes: number;
  /** Minuten ab Abfahrt je Zwischenhalt (eigene oder gleichmäßig verteilt). */
  stopOffsetsMinutes: number[];
  items: ScheduleItemView[];
  summary: {
    total: number;
    new: number;
    existing: number;
    busConflicts: number;
    /** Fahrtage ohne vollständigen Tarif. */
    fareMissingDates: string[];
  };
  /**
   * Wirkung des Lizenzstands (Schritt 2.7, ADR 0032). Die Vorschau meldet `issue` als Warnung, die
   * Veröffentlichung lehnt dann ab (`LICENSE_EXPIRED`, `LICENSE_BUS_LIMIT_EXCEEDED`).
   */
  license: SchedulePlanningLicense;
}

export interface TripCancelResult {
  trip: TripDetailView;
  /** In diesem Aufruf stornierte Buchungen; eine Wiederholung ergibt 0. */
  cancelledBookings: number;
}

interface Evaluation {
  routeStops: PlanningRouteStop[];
  busId: string | null;
  seatLayoutId: string;
  quota: Map<string, boolean>;
  seatCount: number;
  onlineSeats: number;
  genderRuleEnabled: boolean;
  onlineSalesCloseMinutes: number;
  offsets: number[];
  items: ScheduleItem[];
  fareMissingDates: string[];
  license: SchedulePlanningLicense;
}

/** Die Fahrtplanung schreibt bis zu 62 Fahrten samt Halten und Kontingent in einer Transaktion. */
const TX = { maxWait: 5_000, timeout: 20_000 } as const;
/** Höchstens so viele Abfahrten in `params` einer Fehlermeldung. */
const MAX_PARAM_ITEMS = 10;

function toSummaryView(row: TripSummaryRow): TripSummaryView {
  return {
    id: row.id,
    status: row.status,
    serviceDate: row.serviceDate,
    departureAt: row.departureAt,
    arrivalAt: row.arrivalAt,
    onlineSalesCloseAt: row.onlineSalesCloseAt,
    genderRuleEnabled: row.genderRuleEnabled,
    route: { id: row.routeId, nameAr: row.routeNameAr, nameEn: row.routeNameEn },
    bus: row.busId === null ? null : { id: row.busId, plate: row.busPlate ?? '' },
    seatLayout: { id: row.seatLayoutId, name: row.seatLayoutName, version: row.seatLayoutVersion },
    quota: {
      total: row.seatTotal,
      online: row.seatOnline,
      counter: row.seatCounter,
      blocked: row.seatBlocked,
      occupied: row.seatOccupied,
    },
    activeBookings: row.activeBookings,
  };
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Fahrtplanung einer Firma (Schritt 2.4, ADR 0027): Wochenplan veröffentlichen, Fahrten auflisten
 * und lesen, absagen, Kontingent ändern. Die Firma kommt nur aus dem geprüften Pfad.
 *
 * - Veröffentlichen sperrt Firma (`FOR SHARE`, Lizenz), Strecke (`FOR UPDATE`), Bus (`FOR UPDATE`)
 *   und Sitzplan (`FOR SHARE`),
 *   liest danach frisch und legt alle neuen Fahrten in einer Transaktion an. Zwei gleichzeitige
 *   Veröffentlichungen derselben Strecke laufen nacheinander; die zweite sieht die Fahrten der
 *   ersten und überspringt sie.
 * - Absagen und Kontingent laufen über die Trip-Sperre des Buchungsservice (Trip → Booking →
 *   Payment); Belegungen schreibt nur der Buchungsservice.
 */
@Injectable()
export class CompanyTripsService {
  private readonly logger = new Logger(CompanyTripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CompanyTripsRepository,
    private readonly bookings: BookingsService,
    private readonly licenses: LicensesService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // --- Lesen -------------------------------------------------------------------------------------

  async list(
    companyId: string,
    query: ListTripsQuery,
  ): Promise<{ items: TripSummaryView[]; nextCursor: string | null }> {
    const from = query.from ?? this.today();
    const to = query.to ?? addDays(from, TRIP_LIST_DEFAULT_DAYS - 1);
    if (to < from) {
      return { items: [], nextCursor: null };
    }
    if (daySpan(from, to) > TRIP_SCHEDULE_LIMITS.maxDays) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'The range is too long.',
        errors: [{ path: 'to', rule: 'custom' }],
      });
    }
    const rows = await this.repo.listTrips(this.prisma, companyId, {
      start: damascusDayRange(from).start,
      end: damascusDayRange(to).end,
      now: this.clock.now(),
      ...(query.routeId === undefined ? {} : { routeId: query.routeId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toSummaryView),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeTripListCursor({ departureAt: last.departureAt, tripId: last.id })
          : null,
    };
  }

  async get(companyId: string, tripId: string): Promise<TripDetailView> {
    const now = this.clock.now();
    const summary = await this.repo.tripSummary(this.prisma, companyId, tripId, now);
    if (summary === null) {
      throw new AppError('TRIP_NOT_FOUND');
    }
    const [stops, seats] = await Promise.all([
      this.repo.tripStops(this.prisma, tripId),
      this.repo.tripSeats(this.prisma, tripId, now),
    ]);
    return {
      ...toSummaryView(summary),
      stops,
      layout: {
        rows: seats.reduce((max, seat) => Math.max(max, seat.row + 1), 0),
        columns: seats.reduce((max, seat) => Math.max(max, seat.column + 1), 0),
      },
      seats,
    };
  }

  // --- Wochenplan --------------------------------------------------------------------------------

  /** Dieselbe Rechnung wie {@link publish}, ohne Sperren und ohne zu schreiben. */
  async preview(companyId: string, input: ScheduleInput): Promise<ScheduleResult> {
    const evaluation = await this.run((tx) => this.evaluate(tx, companyId, input, false));
    return this.result(input, evaluation, new Map());
  }

  /**
   * Legt je neuem Termin eine Fahrt mit Halten und Kontingent an, alles in einer Transaktion.
   * Vorhandene Termine werden übersprungen (idempotent). Fehlende Tarife und Busüberschneidungen
   * lehnen die ganze Veröffentlichung ab; die Vorschau zeigt beides vorher an.
   */
  async publish(
    companyId: string,
    input: ScheduleInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<ScheduleResult> {
    const { evaluation, createdIds } = await this.run(async (tx) => {
      const evaluation = await this.evaluate(tx, companyId, input, true);
      // Lizenz zuerst (ADR 0032): Nach der Kulanz plant die Firma nichts Neues, und mit einem Bus
      // über den gebuchten Paketen auch nicht. Bestehende Fahrten und Buchungen bleiben unberührt.
      const { license } = evaluation;
      if (license.issue === 'LICENSE_EXPIRED') {
        throw new AppError('LICENSE_EXPIRED', {
          detail: 'The license and its grace period have ended; no new trips can be planned.',
          params: { validUntil: license.coveredUntil, graceEndsOn: license.graceEndsOn },
        });
      }
      if (license.issue === 'LICENSE_BUS_LIMIT_EXCEEDED') {
        throw new AppError('LICENSE_BUS_LIMIT_EXCEEDED', {
          detail: 'The bus is not covered by the booked bus packages.',
          params: { allowedBuses: license.allowedBuses, activeBuses: license.activeBuses },
        });
      }
      if (evaluation.fareMissingDates.length > 0) {
        throw new AppError('FARE_MISSING_FOR_DATE', {
          detail: 'Some service days have no complete fare matrix.',
          params: { dates: evaluation.fareMissingDates.slice(0, MAX_PARAM_ITEMS) },
        });
      }
      const conflicts = evaluation.items.filter((item) => item.state === 'BUS_CONFLICT');
      if (conflicts.length > 0) {
        throw new AppError('BUS_DOUBLE_BOOKED', {
          detail: 'The bus is already on the road at some of these times.',
          params: {
            departures: conflicts
              .slice(0, MAX_PARAM_ITEMS)
              .map((item) => item.planned.departureAt.toISOString()),
          },
        });
      }
      const fresh = evaluation.items.filter((item) => item.state === 'NEW');
      const created = await this.repo.insertTrips(
        tx,
        fresh.map((item) => this.newTrip(companyId, input, evaluation, item.planned)),
        evaluation.routeStops,
        evaluation.quota,
      );
      const createdIds = new Map(created.map((row) => [row.departureAt.getTime(), row.id]));
      await this.audit.record(
        {
          action: 'TRIP_SCHEDULE_PUBLISHED',
          actorType: 'USER',
          actorId: actor.userId,
          companyId,
          entityType: 'route',
          entityId: input.routeId,
          data: {
            from: input.from,
            to: input.to,
            weekdays: [...input.weekdays].sort(),
            departureTime: input.departureTime,
            durationMinutes: input.durationMinutes,
            busId: evaluation.busId,
            seatLayoutId: evaluation.seatLayoutId,
            onlineSeats: evaluation.onlineSeats,
            created: created.length,
            skipped: evaluation.items.length - created.length,
            tripIds: created.map((row) => row.id),
          },
        },
        context,
        tx,
      );
      return { evaluation, createdIds };
    });
    this.logger.log(
      {
        companyId,
        routeId: input.routeId,
        created: createdIds.size,
        licenseStatus: evaluation.license.status,
      },
      'Wochenplan veröffentlicht',
    );
    return this.result(input, evaluation, createdIds);
  }

  // --- Absagen und Kontingent ---------------------------------------------------------------------

  /**
   * Sagt eine Fahrt ab: Trip-Zeile sperren, Status `CANCELLED`, alle aktiven Buchungen stornieren
   * (Buchungsservice, Trip → Booking). Eine Wiederholung ändert nichts.
   */
  async cancel(
    companyId: string,
    tripId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<TripCancelResult> {
    const cancelled = await this.run(async (tx) => {
      const now = this.clock.now();
      const trip = await this.bookings.lockTripForPlanning(tx, companyId, tripId, now);
      if (trip === null) {
        throw new AppError('TRIP_NOT_FOUND');
      }
      const step = tripTransition(trip.status, 'CANCELLED');
      if (step === 'NOOP') {
        return 0;
      }
      if (step === 'REJECT') {
        throw new AppError('INVALID_STATE_TRANSITION', {
          detail: 'Only scheduled trips can be cancelled.',
        });
      }
      await this.repo.markCancelled(tx, tripId, now);
      const freed = await this.bookings.cancelBookingsOfCancelledTrip(tx, {
        tripId,
        actorUserId: actor.userId,
        context,
        now,
      });
      await this.record(tx, 'TRIP_CANCELLED', companyId, tripId, actor, context, {
        from: trip.status,
        to: 'CANCELLED',
        cancelledBookings: freed.bookings,
        seatsFreed: freed.seatsFreed,
        ticketsVoided: freed.ticketsVoided,
      });
      return freed.bookings;
    });
    return { trip: await this.get(companyId, tripId), cancelledBookings: cancelled };
  }

  /**
   * Ändert das Online-Kontingent einzelner Sitze unter der Trip-Sperre. Belegte Sitze wechseln den
   * Kanal nicht (`TRIP_SEAT_OCCUPIED`); nur Fahrten im Verkauf (`SCHEDULED`, noch nicht abgefahren).
   */
  async updateQuota(
    companyId: string,
    tripId: string,
    input: UpdateQuotaInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<TripDetailView> {
    await this.run(async (tx) => {
      const now = this.clock.now();
      const trip = await this.bookings.lockTripForPlanning(tx, companyId, tripId, now);
      if (trip === null) {
        throw new AppError('TRIP_NOT_FOUND');
      }
      if (trip.status !== 'SCHEDULED' || trip.departureAt.getTime() <= now.getTime()) {
        throw new AppError('TRIP_NOT_BOOKABLE', { detail: 'The trip is not on sale.' });
      }
      const plan = planQuotaChange(await this.repo.tripSeatStates(tx, tripId, now), input.seats);
      if (plan.kind === 'SEAT_UNKNOWN') {
        throw new AppError('SEAT_UNKNOWN', {
          detail: 'A seat does not belong to the trip.',
          params: { seatIds: plan.seatIds.slice(0, MAX_PARAM_ITEMS) },
        });
      }
      if (plan.kind === 'TRIP_SEAT_OCCUPIED') {
        throw new AppError('TRIP_SEAT_OCCUPIED', {
          detail: 'Occupied seats keep their sales channel.',
          params: { seats: plan.labels },
        });
      }
      const toOnline = plan.changes.filter((c) => c.onlineSellable).map((c) => c.seatId);
      const toCounter = plan.changes.filter((c) => !c.onlineSellable).map((c) => c.seatId);
      await this.repo.setOnlineSellable(tx, tripId, toOnline, true, now);
      await this.repo.setOnlineSellable(tx, tripId, toCounter, false, now);
      if (plan.changes.length > 0) {
        await this.record(tx, 'TRIP_QUOTA_CHANGED', companyId, tripId, actor, context, {
          toOnline: toOnline.length,
          toCounter: toCounter.length,
        });
      }
    });
    return this.get(companyId, tripId);
  }

  // --- Bausteine ---------------------------------------------------------------------------------

  /**
   * Gemeinsame Rechnung von Vorschau und Veröffentlichung. Mit `lock` in der Reihenfolge Firma
   * (`FOR SHARE`, Lizenz und aktive Busse) → Strecke → Bus → Sitzplan gesperrt und danach frisch
   * gelesen.
   */
  private async evaluate(
    tx: Tx,
    companyId: string,
    input: ScheduleInput,
    lock: boolean,
  ): Promise<Evaluation> {
    const now = this.clock.now();
    const planned = this.expand(input);
    if (scheduleInPast(input.from, this.today(), planned, now)) {
      throw new AppError('TRIP_SCHEDULE_IN_PAST', {
        detail: 'The schedule starts in the past.',
      });
    }
    if (lock) {
      await this.licenses.lockForPlanning(tx, companyId);
    }

    const route = await this.repo.route(tx, companyId, input.routeId, lock);
    if (route === null) {
      throw new AppError('ROUTE_NOT_FOUND');
    }
    if (!route.isActive) {
      throw new AppError('ROUTE_ARCHIVED');
    }
    const routeStops = await this.repo.routeStops(tx, route.id);
    if (stopOffsetsIssue(routeStops.length, input.durationMinutes, input.stopOffsetsMinutes)) {
      throw new AppError('TRIP_STOP_OFFSETS_INVALID', {
        detail: 'Stop times must rise along the route and stay within the duration.',
        params: { intermediateStops: Math.max(routeStops.length - 2, 0) },
      });
    }
    const offsets =
      input.stopOffsetsMinutes ?? evenStopOffsets(routeStops.length, input.durationMinutes);

    let busId: string | null = null;
    let seatLayoutId = input.seatLayoutId ?? '';
    if (input.busId !== undefined) {
      const bus = await this.repo.bus(tx, companyId, input.busId, lock);
      if (bus === null) {
        throw new AppError('BUS_NOT_FOUND');
      }
      if (bus.status === 'INACTIVE') {
        throw new AppError('BUS_INACTIVE', { detail: 'The bus is deactivated.' });
      }
      busId = bus.id;
      seatLayoutId = bus.seatLayoutId;
    }
    const layout = await this.repo.layout(tx, companyId, seatLayoutId, lock);
    if (layout === null) {
      throw new AppError('SEAT_LAYOUT_NOT_FOUND');
    }
    if (layout.status === 'RETIRED') {
      throw new AppError('SEAT_LAYOUT_RETIRED');
    }
    const license = await this.licenses.planningLicense(tx, companyId, busId);
    const seats = await this.repo.layoutSeats(tx, layout.id);
    const seatCount = sellableSeatCount(seats);
    if (input.onlineSeatCount !== undefined && input.onlineSeatCount > seatCount) {
      throw new AppError('TRIP_QUOTA_INVALID', {
        detail: 'More online seats than sellable seats.',
        params: { max: seatCount },
      });
    }
    const quota = onlineQuota(seats, input.onlineSeatCount);

    const fareMissingDates = datesWithoutFares(
      planned.map((trip) => trip.serviceDate),
      routeStops.length,
      await this.repo.routeFares(tx, route.id),
    );
    const settings = await this.repo.companySettings(tx, companyId);
    const sameSlot = await this.repo.sameSlotTrips(tx, {
      routeId: route.id,
      busId,
      seatLayoutId: layout.id,
      departures: planned.map((trip) => trip.departureAt),
    });
    const first = planned[0];
    const last = planned.at(-1);
    const busBusy =
      busId === null || first === undefined || last === undefined
        ? []
        : await this.repo.busBusy(tx, busId, { start: first.departureAt, end: last.arrivalAt });

    return {
      routeStops,
      busId,
      seatLayoutId: layout.id,
      quota,
      seatCount,
      onlineSeats: [...quota.values()].filter(Boolean).length,
      genderRuleEnabled: input.genderRuleEnabled ?? settings.genderRuleEnabled,
      onlineSalesCloseMinutes: input.onlineSalesCloseMinutes ?? settings.onlineSalesCloseMinutes,
      offsets,
      items: classifySchedule(planned, sameSlot, busBusy),
      fareMissingDates,
      license,
    };
  }

  private expand(input: ScheduleInput): PlannedTrip[] {
    try {
      return expandSchedule(
        {
          weekdays: input.weekdays,
          departureTime: input.departureTime,
          durationMinutes: input.durationMinutes,
        },
        input.from,
        input.to,
      );
    } catch (error) {
      // Das Schema prüft dieselben Grenzen; hier landet nur, was es übersehen hätte.
      if (error instanceof RangeError) {
        throw new AppError('VALIDATION_FAILED', { detail: 'The schedule is invalid.' });
      }
      throw error;
    }
  }

  private newTrip(
    companyId: string,
    input: ScheduleInput,
    evaluation: Evaluation,
    planned: PlannedTrip,
  ): NewTrip {
    return {
      companyId,
      routeId: input.routeId,
      seatLayoutId: evaluation.seatLayoutId,
      busId: evaluation.busId,
      serviceDate: planned.serviceDate,
      departureAt: planned.departureAt,
      arrivalAt: planned.arrivalAt,
      onlineSalesCloseAt: onlineSalesCloseAt(
        planned.departureAt,
        evaluation.onlineSalesCloseMinutes,
      ),
      genderRuleEnabled: evaluation.genderRuleEnabled,
      stops: planStopTimes(evaluation.routeStops.length, planned, evaluation.offsets),
    };
  }

  private result(
    input: ScheduleInput,
    evaluation: Evaluation,
    createdIds: Map<number, string>,
  ): ScheduleResult {
    const missing = new Set(evaluation.fareMissingDates);
    const items = evaluation.items.map((item): ScheduleItemView => ({
      serviceDate: item.planned.serviceDate,
      departureAt: item.planned.departureAt,
      arrivalAt: item.planned.arrivalAt,
      state: item.state,
      tripId: item.existingTripId ?? createdIds.get(item.planned.departureAt.getTime()) ?? null,
      fareMissing: missing.has(item.planned.serviceDate),
      stops: planStopTimes(evaluation.routeStops.length, item.planned, evaluation.offsets),
    }));
    const count = (state: ScheduleItemState): number =>
      items.filter((item) => item.state === state).length;
    return {
      routeId: input.routeId,
      busId: evaluation.busId,
      seatLayoutId: evaluation.seatLayoutId,
      seatCount: evaluation.seatCount,
      onlineSeats: evaluation.onlineSeats,
      genderRuleEnabled: evaluation.genderRuleEnabled,
      onlineSalesCloseMinutes: evaluation.onlineSalesCloseMinutes,
      stopOffsetsMinutes: evaluation.offsets,
      items,
      summary: {
        total: items.length,
        new: count('NEW'),
        existing: count('EXISTS'),
        busConflicts: count('BUS_CONFLICT'),
        fareMissingDates: evaluation.fareMissingDates,
      },
      license: evaluation.license,
    };
  }

  private today(): string {
    return localDateInDamascus(this.clock.now());
  }

  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TX);
    } catch (error) {
      throw mapTripsError(error);
    }
  }

  private async record(
    tx: Tx,
    action: string,
    companyId: string,
    tripId: string,
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
        entityType: 'trip',
        entityId: tripId,
        data,
      },
      context,
      tx,
    );
  }
}
