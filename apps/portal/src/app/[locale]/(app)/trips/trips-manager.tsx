'use client';

import {
  formatTime,
  type Locale,
  localDateInDamascus,
  WEEKDAYS_FROM_SATURDAY,
} from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

import { SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { Link } from '../../../../i18n/navigation';
import { api, type Problem } from '../../../../lib/api';
import type { Bus, LayoutSummary } from '../../../../lib/fleet';
import { formatCalendarDay, localName, type RouteSummary } from '../../../../lib/routes';
import {
  addDays,
  canCancelTrip,
  type DraftField,
  formatDeparture,
  type ScheduleBody,
  scheduleBody,
  type ScheduleDraft,
  type ScheduleResult,
  todayInDamascus,
  type TripDetail,
  type TripSummary,
  weekdayName,
} from '../../../../lib/trips';
import { QuotaMap } from './quota-map';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/** Zeitraum der Liste: heute und die folgenden 13 Tage (wie der Standard der API). */
const LIST_DAYS = 14;

/** Codes mit eigenem Text im Bereich Fahrten; alles andere übersetzt ProblemMessage. */
const TRIP_CODES = new Set([
  'TRIP_SCHEDULE_IN_PAST',
  'TRIP_STOP_OFFSETS_INVALID',
  'TRIP_QUOTA_INVALID',
  'FARE_MISSING_FOR_DATE',
  'BUS_INACTIVE',
  'BUS_DOUBLE_BOOKED',
  'TRIP_SEAT_OCCUPIED',
  'ROUTE_ARCHIVED',
  'ROUTE_NOT_FOUND',
  'BUS_NOT_FOUND',
  'SEAT_LAYOUT_NOT_FOUND',
  'SEAT_LAYOUT_RETIRED',
  'TRIP_NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'VALIDATION_FAILED',
  'SERVICE_UNAVAILABLE',
]);

const SELECT =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const INPUT =
  'rounded-md border border-slate-300 px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const SMALL_INPUT =
  'w-20 rounded-md border border-slate-300 px-3 py-2 text-end focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const SECONDARY_BUTTON =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60';
const DANGER_BUTTON =
  'rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60';

const STATUS_BADGE: Record<TripSummary['status'], string> = {
  DRAFT: 'bg-slate-200 text-slate-700',
  SCHEDULED: 'bg-emerald-100 text-emerald-900',
  DEPARTED: 'bg-sky-100 text-sky-900',
  COMPLETED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-red-100 text-red-900',
};

function Alert({ children }: { children: ReactNode }): ReactNode {
  return (
    <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
      {children}
    </p>
  );
}

/** Fehlertext; Tage und Abfahrten aus `params` erscheinen in Ortszeit mit westlichen Ziffern. */
function TripProblem({ failure }: { failure: Failure }): ReactNode {
  const t = useTranslations('trips.errors');
  const locale = useLocale() as Locale;
  const { problem } = failure;
  if (!TRIP_CODES.has(problem.code)) {
    return <ProblemMessage {...failure} />;
  }
  const params = problem.params ?? {};
  const list = (key: string): string[] =>
    Array.isArray(params[key]) ? (params[key] as unknown[]).map(String) : [];
  return (
    <Alert>
      {t(problem.code, {
        max: typeof params.max === 'number' ? String(params.max) : '',
        dates: list('dates')
          .map((day) => formatCalendarDay(day, locale))
          .join('، '),
        departures: list('departures')
          .map((iso) => formatDeparture(iso, locale))
          .join(' · '),
        seats: list('seats').join(', '),
      })}
    </Alert>
  );
}

/**
 * Fahrten einer Firma: Liste der kommenden Fahrten, Formular „Woche planen" mit Vorschau über die
 * API (dieselbe Rechnung wie das Veröffentlichen) und Absage mit Bestätigung. Die Firma steht nur
 * im Pfad der API; `canWrite` blendet Formular und Aktionen nur aus.
 */
export function TripsManager({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}): ReactNode {
  const t = useTranslations('trips');
  const base = `/companies/${companyId}`;
  const [trips, setTrips] = useState<TripSummary[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const [loadFailure, setLoadFailure] = useState<Failure>();
  const [notice, setNotice] = useState<string>();

  const listQuery = useCallback((cursor?: string): string => {
    const from = todayInDamascus();
    const query = new URLSearchParams({ from, to: addDays(from, LIST_DAYS - 1) });
    if (cursor !== undefined) query.set('cursor', cursor);
    return `?${query.toString()}`;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const tripResult = await api<{ items: TripSummary[]; nextCursor: string | null }>(
      `${base}/trips${listQuery()}`,
    );
    if (!tripResult.ok) {
      setLoadFailure(tripResult);
      return;
    }
    if (canWrite) {
      const [routeResult, busResult, layoutResult] = await Promise.all([
        api<{ items: RouteSummary[] }>(`${base}/routes?status=ACTIVE`),
        api<{ items: Bus[] }>(`${base}/buses`),
        api<{ items: LayoutSummary[] }>(`${base}/seat-layouts?status=ACTIVE`),
      ]);
      for (const result of [routeResult, busResult, layoutResult]) {
        if (!result.ok) {
          setLoadFailure(result);
          return;
        }
      }
      if (routeResult.ok && busResult.ok && layoutResult.ok) {
        setRoutes(routeResult.data.items);
        setBuses(busResult.data.items.filter((bus) => bus.status === 'ACTIVE'));
        setLayouts(layoutResult.data.items);
      }
    }
    setLoadFailure(undefined);
    setTrips(tripResult.data.items);
    setNextCursor(tripResult.data.nextCursor);
  }, [base, canWrite, listQuery]);

  useEffect(() => {
    // Erstes Laden nach dem Einhängen; setState erst nach der Antwort der API.
    void reload();
  }, [reload]);

  const done = useCallback(
    async (message: string): Promise<void> => {
      setNotice(message);
      await reload();
    },
    [reload],
  );

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;
    const result = await api<{ items: TripSummary[]; nextCursor: string | null }>(
      `${base}/trips${listQuery(nextCursor)}`,
    );
    if (result.ok) {
      setTrips([...(trips ?? []), ...result.data.items]);
      setNextCursor(result.data.nextCursor);
    } else {
      setLoadFailure(result);
    }
  }

  if (loadFailure !== undefined) {
    return <TripProblem failure={loadFailure} />;
  }
  if (trips === undefined) {
    return <p className="text-slate-600">{t('loading')}</p>;
  }

  return (
    <>
      {notice === undefined ? null : (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      {canWrite ? null : (
        <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-700">{t('readOnly')}</p>
      )}
      <TripsSection
        base={base}
        trips={trips}
        canWrite={canWrite}
        hasMore={nextCursor !== null}
        onMore={loadMore}
        onDone={done}
      />
      {canWrite ? (
        <ScheduleForm base={base} routes={routes} buses={buses} layouts={layouts} onDone={done} />
      ) : null}
    </>
  );
}

function TripsSection({
  base,
  trips,
  canWrite,
  hasMore,
  onMore,
  onDone,
}: {
  base: string;
  trips: TripSummary[];
  canWrite: boolean;
  hasMore: boolean;
  onMore: () => Promise<void>;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('trips');
  const locale = useLocale() as Locale;
  const [openId, setOpenId] = useState<string>();
  const [detail, setDetail] = useState<TripDetail>();
  const [confirmId, setConfirmId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();

  async function toggle(id: string): Promise<void> {
    if (openId === id) {
      setOpenId(undefined);
      return;
    }
    setOpenId(id);
    setDetail(undefined);
    const result = await api<TripDetail>(`${base}/trips/${id}`);
    if (result.ok) {
      setDetail(result.data);
    } else {
      setFailure(result);
    }
  }

  async function cancel(trip: TripSummary): Promise<void> {
    setBusy(true);
    const result = await api<{ trip: TripDetail; cancelledBookings: number }>(
      `${base}/trips/${trip.id}/cancel`,
      { method: 'POST', body: {} },
    );
    setBusy(false);
    setConfirmId(undefined);
    if (result.ok) {
      setFailure(undefined);
      if (openId === trip.id) setDetail(result.data.trip);
      await onDone(t('list.cancelled', { count: String(result.data.cancelledBookings) }));
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="trips-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="trips-heading" className="text-xl font-semibold">
          {t('list.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('list.range')}</p>
      </div>
      {failure === undefined ? null : <TripProblem failure={failure} />}
      {trips.length === 0 ? (
        <p className="text-slate-600">{t('list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {trips.map((trip) => {
            const routeName = localName(trip.route, locale);
            const departure = formatDeparture(trip.departureAt, locale);
            return (
              <li key={trip.id}>
                <article
                  aria-label={t('list.label', { departure, route: routeName })}
                  data-trip-id={trip.id}
                  className="flex flex-col gap-3 rounded-md border border-brand-100 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="font-semibold tabular-nums">
                        {t('list.times', {
                          departure,
                          arrival: formatDeparture(trip.arrivalAt, locale),
                        })}
                      </h3>
                      <p className="text-sm text-slate-700">{routeName}</p>
                      <p className="text-sm text-slate-600">
                        {trip.bus === null
                          ? t('list.noBus')
                          : t('list.bus', { plate: trip.bus.plate })}
                        {' · '}
                        {t('list.bookings', { count: String(trip.activeBookings) })}
                      </p>
                      <p className="text-sm text-slate-600 tabular-nums">
                        {t('list.quota', {
                          online: String(trip.quota.online),
                          counter: String(trip.quota.counter),
                          blocked: String(trip.quota.blocked),
                          occupied: String(trip.quota.occupied),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[trip.status]}`}
                      >
                        {t(`status.${trip.status}`)}
                      </span>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        aria-expanded={openId === trip.id}
                        onClick={() => void toggle(trip.id)}
                      >
                        {openId === trip.id ? t('list.hide') : t('list.show')}
                      </button>
                      {canWrite && canCancelTrip(trip) && confirmId !== trip.id ? (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON}
                          onClick={() => setConfirmId(trip.id)}
                        >
                          {t('list.cancel')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {confirmId === trip.id ? (
                    <div
                      role="group"
                      aria-label={t('list.cancel')}
                      className="flex flex-col gap-2 rounded-md bg-red-50 p-3"
                    >
                      <p className="text-sm text-red-900">
                        {t('list.cancelQuestion', { count: String(trip.activeBookings) })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={DANGER_BUTTON}
                          disabled={busy}
                          onClick={() => void cancel(trip)}
                        >
                          {t('list.cancelConfirm')}
                        </button>
                        <button
                          type="button"
                          className={SECONDARY_BUTTON}
                          disabled={busy}
                          onClick={() => setConfirmId(undefined)}
                        >
                          {t('list.cancelBack')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {openId === trip.id ? (
                    detail?.id === trip.id ? (
                      <TripDetailView trip={detail} />
                    ) : (
                      <p className="text-sm text-slate-600">{t('loading')}</p>
                    )
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <div>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => void onMore()}>
            {t('list.more')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Uhrzeit eines Halts; liegt er auf einem späteren Tag als die Abfahrt, mit „+1 Tag". */
function StopTime({ iso, serviceDate }: { iso: string; serviceDate: string }): ReactNode {
  const t = useTranslations('trips.detail');
  const locale = useLocale() as Locale;
  const day = localDateInDamascus(iso);
  const days = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${serviceDate}T00:00:00Z`)) / 86_400_000,
  );
  return (
    <span className="tabular-nums">
      {formatTime(iso, locale)}
      {days > 0 ? (
        <span className="ms-1 text-xs text-slate-500">{t('nextDay', { days: String(days) })}</span>
      ) : null}
    </span>
  );
}

function TripDetailView({ trip }: { trip: TripDetail }): ReactNode {
  const t = useTranslations('trips.detail');
  const locale = useLocale() as Locale;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('stops')}</h4>
        <ol className="flex flex-col gap-1 text-sm">
          {trip.stops.map((stop) => {
            const time = stop.departureAt ?? stop.arrivalAt;
            return (
              <li key={stop.id} className="flex flex-wrap items-baseline gap-2">
                <span className="min-w-14">
                  {time === null ? '–' : <StopTime iso={time} serviceDate={trip.serviceDate} />}
                </span>
                <span>{localName(stop.station, locale)}</span>
                <span className="text-slate-500">({localName(stop.city, locale)})</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('quota')}</h4>
        <QuotaMap
          seats={trip.seats}
          label={t('map', { departure: formatDeparture(trip.departureAt, locale) })}
        />
      </div>
      <p className="md:col-span-2">
        <Link
          href={`/trips/${trip.id}/passengers`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          {t('passengers', { count: String(trip.activeBookings) })}
        </Link>
      </p>
    </div>
  );
}

function initialDraft(): ScheduleDraft {
  const tomorrow = addDays(todayInDamascus(), 1);
  return {
    routeId: '',
    vehicle: '',
    weekdays: [...WEEKDAYS_FROM_SATURDAY],
    departureTime: '07:00',
    durationHours: '5',
    durationMinutes: '0',
    from: tomorrow,
    to: addDays(tomorrow, 6),
    onlineSeats: '',
    genderRule: 'company',
    salesCloseMinutes: '',
  };
}

function ScheduleForm({
  base,
  routes,
  buses,
  layouts,
  onDone,
}: {
  base: string;
  routes: RouteSummary[];
  buses: Bus[];
  layouts: LayoutSummary[];
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('trips.form');
  const locale = useLocale() as Locale;
  const [draft, setDraft] = useState<ScheduleDraft>(initialDraft);
  const [invalid, setInvalid] = useState<DraftField>();
  const [preview, setPreview] = useState<{ key: string; result: ScheduleResult }>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const built = scheduleBody(draft);
  const key = built.ok ? JSON.stringify(built.body) : null;
  const current = preview !== undefined && preview.key === key ? preview.result : undefined;
  const stale = preview !== undefined && preview.key !== key;

  function change<K extends keyof ScheduleDraft>(field: K, value: ScheduleDraft[K]): void {
    setDraft({ ...draft, [field]: value });
    setInvalid(undefined);
  }

  function toggleWeekday(day: number): void {
    change(
      'weekdays',
      draft.weekdays.includes(day)
        ? draft.weekdays.filter((entry) => entry !== day)
        : [...draft.weekdays, day],
    );
  }

  async function call(path: string, body: ScheduleBody): Promise<ScheduleResult | null> {
    setBusy(true);
    const result = await api<ScheduleResult>(`${base}/trips/${path}`, { method: 'POST', body });
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      return null;
    }
    setFailure(undefined);
    return result.data;
  }

  async function showPreview(): Promise<void> {
    if (!built.ok) {
      setInvalid(built.field);
      return;
    }
    const result = await call('schedule/preview', built.body);
    setPreview(result === null || key === null ? undefined : { key, result });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!built.ok) {
      setInvalid(built.field);
      return;
    }
    if (current === undefined) {
      await showPreview();
      return;
    }
    const result = await call('schedule', built.body);
    if (result !== null) {
      setPreview(undefined);
      await onDone(
        t('published', {
          new: String(result.summary.new),
          existing: String(result.summary.existing),
        }),
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="schedule-form-heading"
      className="flex flex-col gap-5 rounded-md border border-brand-100 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="schedule-form-heading" className="text-xl font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-slate-600">{t('hint')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('route')}</span>
          <select
            value={draft.routeId}
            onChange={(event) => change('routeId', event.target.value)}
            className={SELECT}
          >
            <option value="">{t('chooseRoute')}</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {localName(route, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('vehicle')}</span>
          <select
            value={draft.vehicle}
            onChange={(event) => change('vehicle', event.target.value)}
            className={SELECT}
          >
            <option value="">{t('chooseVehicle')}</option>
            {buses.map((bus) => (
              <option key={bus.id} value={`bus:${bus.id}`}>
                {t('busOption', { plate: bus.plate, layout: bus.seatLayout.name })}
              </option>
            ))}
            {layouts.map((layout) => (
              <option key={layout.id} value={`layout:${layout.id}`}>
                {t('layoutOption', { name: layout.name, version: String(layout.version) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('weekdays')}</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS_FROM_SATURDAY.map((day) => (
            <label key={day} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={draft.weekdays.includes(day)}
                onChange={() => toggleWeekday(day)}
              />
              {weekdayName(day, locale)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('departureTime')}</span>
          <input
            value={draft.departureTime}
            onChange={(event) => change('departureTime', event.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className={INPUT}
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t('duration')}</legend>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm">
              <input
                value={draft.durationHours}
                onChange={(event) => change('durationHours', event.target.value)}
                inputMode="numeric"
                dir="ltr"
                aria-label={t('hours')}
                className={SMALL_INPUT}
              />
              {t('hours')}
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                value={draft.durationMinutes}
                onChange={(event) => change('durationMinutes', event.target.value)}
                inputMode="numeric"
                dir="ltr"
                aria-label={t('minutes')}
                className={SMALL_INPUT}
              />
              {t('minutes')}
            </label>
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('from')}</span>
          <input
            value={draft.from}
            onChange={(event) => change('from', event.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('to')}</span>
          <input
            value={draft.to}
            onChange={(event) => change('to', event.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className={INPUT}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('onlineSeats')}</span>
          <input
            value={draft.onlineSeats}
            onChange={(event) => change('onlineSeats', event.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className={INPUT}
          />
          <span className="text-xs text-slate-500">{t('onlineSeatsHint')}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('genderRule')}</span>
          <select
            value={draft.genderRule}
            onChange={(event) => change('genderRule', event.target.value)}
            className={SELECT}
          >
            <option value="company">{t('genderCompany')}</option>
            <option value="on">{t('genderOn')}</option>
            <option value="off">{t('genderOff')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('salesClose')}</span>
          <input
            value={draft.salesCloseMinutes}
            onChange={(event) => change('salesCloseMinutes', event.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className={INPUT}
          />
          <span className="text-xs text-slate-500">{t('salesCloseHint')}</span>
        </label>
      </div>
      <p className="text-xs text-slate-500">{t('stopTimesHint')}</p>

      {invalid === undefined ? null : <Alert>{t(`invalid.${invalid}`)}</Alert>}
      {failure === undefined ? null : <TripProblem failure={failure} />}
      {stale ? <p className="text-sm text-amber-900">{t('stale')}</p> : null}
      {current === undefined ? null : <SchedulePreview result={current} />}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => void showPreview()}
        >
          {t('preview')}
        </button>
        <SubmitButton busy={busy || current === undefined || current.summary.new === 0}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}

function SchedulePreview({ result }: { result: ScheduleResult }): ReactNode {
  const t = useTranslations('trips.form');
  const locale = useLocale() as Locale;
  const { summary } = result;
  return (
    <section
      aria-labelledby="schedule-preview-heading"
      className="flex flex-col gap-2 rounded-md bg-brand-50 p-3"
    >
      <h3 id="schedule-preview-heading" className="font-medium">
        {t('previewTitle')}
      </h3>
      <p className="text-sm text-slate-700" data-testid="schedule-summary">
        {t('previewSummary', {
          total: String(summary.total),
          new: String(summary.new),
          existing: String(summary.existing),
          conflicts: String(summary.busConflicts),
        })}
      </p>
      <p className="text-sm text-slate-600">
        {t('previewSeats', {
          online: String(result.onlineSeats),
          seats: String(result.seatCount),
          minutes: String(result.onlineSalesCloseMinutes),
        })}
      </p>
      {summary.total === 0 ? <p className="text-sm text-slate-600">{t('previewEmpty')}</p> : null}
      {summary.fareMissingDates.length > 0 ? (
        <p className="text-sm text-amber-900">
          {t('fareMissing', {
            dates: summary.fareMissingDates.map((day) => formatCalendarDay(day, locale)).join('، '),
          })}
        </p>
      ) : null}
      {summary.busConflicts > 0 ? (
        <p className="text-sm text-amber-900">{t('busConflictWarning')}</p>
      ) : null}
      {result.items.length === 0 ? null : (
        <ol className="flex flex-col gap-1 text-sm" aria-label={t('previewTitle')}>
          {result.items.map((item) => (
            <li
              key={item.departureAt}
              className="flex flex-wrap items-center gap-2 rounded-md bg-white px-2 py-1"
            >
              <span className="tabular-nums">
                {formatDeparture(item.departureAt, locale)} – {formatTime(item.arrivalAt, locale)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  item.state === 'NEW'
                    ? 'bg-emerald-100 text-emerald-900'
                    : item.state === 'EXISTS'
                      ? 'bg-slate-200 text-slate-700'
                      : 'bg-amber-100 text-amber-900'
                }`}
              >
                {t(`state.${item.state}`)}
              </span>
              {item.fareMissing ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  {t('noFareBadge')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
