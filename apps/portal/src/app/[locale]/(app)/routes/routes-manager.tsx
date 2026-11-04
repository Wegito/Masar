'use client';

import { type Locale, ROUTE_LIMITS } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { api, formText, type Problem } from '../../../../lib/api';
import {
  type CatalogCity,
  fareMatrixDraft,
  formatCalendarDay,
  formatFare,
  localName,
  pairKey,
  type Policy,
  type RouteDetail,
  type RouteSummary,
  STANDARD_POLICY_RULES,
  suggestFares,
} from '../../../../lib/routes';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/** Codes mit eigenem Text im Bereich Strecken; alles andere übersetzt ProblemMessage. */
const ROUTE_CODES = new Set([
  'ROUTE_NOT_FOUND',
  'ROUTE_IN_USE',
  'ROUTE_ARCHIVED',
  'ROUTE_STOP_DUPLICATE',
  'STATION_NOT_FOUND',
  'CITY_NOT_FOUND',
  'CANCELLATION_POLICY_NOT_FOUND',
  'CANCELLATION_RULES_INVALID',
  'FARE_MATRIX_INCOMPLETE',
  'FARE_MATRIX_INVALID',
  'FARE_VALID_FROM_PAST',
]);

const SELECT =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const SECONDARY_BUTTON =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60';
const AMOUNT_INPUT =
  'w-24 rounded-md border border-slate-300 px-2 py-1 text-end focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

function Alert({ children }: { children: ReactNode }): ReactNode {
  return (
    <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
      {children}
    </p>
  );
}

/** Fehlertext; `stopName` löst Positionen aus `params` in Haltestellennamen auf. */
function RouteProblem({
  failure,
  stopName,
}: {
  failure: Failure;
  stopName?: (seq: number) => string;
}): ReactNode {
  const t = useTranslations('routes.errors');
  const { problem } = failure;
  if (problem.code === 'FARE_NOT_MONOTONIC' && stopName !== undefined) {
    const pair = problem.params?.pair as [number, number] | undefined;
    const contained = problem.params?.contained as [number, number] | undefined;
    if (pair !== undefined && contained !== undefined) {
      return (
        <Alert>
          {t('FARE_NOT_MONOTONIC', {
            from: stopName(pair[0]),
            to: stopName(pair[1]),
            containedFrom: stopName(contained[0]),
            containedTo: stopName(contained[1]),
          })}
        </Alert>
      );
    }
  }
  if (problem.code === 'FARE_NOT_MONOTONIC' || ROUTE_CODES.has(problem.code)) {
    return (
      <Alert>
        {problem.code === 'FARE_NOT_MONOTONIC' ? t('FARE_MATRIX_INVALID') : t(problem.code)}
      </Alert>
    );
  }
  return <ProblemMessage {...failure} />;
}

/**
 * Strecken, Stornoregeln und Haltestellen-Katalog einer Firma. Die Firma steht nur im Pfad der
 * API; ob die Person schreiben darf, prüft die API selbst. `canWrite` blendet Formulare und
 * Aktionen nur aus.
 */
export function RoutesManager({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}): ReactNode {
  const t = useTranslations('routes');
  const [routes, setRoutes] = useState<RouteSummary[]>();
  const [policies, setPolicies] = useState<Policy[]>();
  const [catalog, setCatalog] = useState<CatalogCity[]>();
  const [loadFailure, setLoadFailure] = useState<Failure>();
  const [notice, setNotice] = useState<string>();
  const base = `/companies/${companyId}`;

  const reload = useCallback(async (): Promise<void> => {
    const [routeResult, policyResult, catalogResult] = await Promise.all([
      api<{ items: RouteSummary[] }>(`${base}/routes`),
      api<{ items: Policy[] }>(`${base}/cancellation-policies`),
      api<{ items: CatalogCity[] }>(`${base}/stations`),
    ]);
    for (const result of [routeResult, policyResult, catalogResult]) {
      if (!result.ok) {
        setLoadFailure(result);
        return;
      }
    }
    if (routeResult.ok && policyResult.ok && catalogResult.ok) {
      setLoadFailure(undefined);
      setRoutes(routeResult.data.items);
      setPolicies(policyResult.data.items);
      setCatalog(catalogResult.data.items);
    }
  }, [base]);

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

  if (loadFailure !== undefined) {
    return <RouteProblem failure={loadFailure} />;
  }
  if (routes === undefined || policies === undefined || catalog === undefined) {
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
      <RoutesSection base={base} routes={routes} canWrite={canWrite} onDone={done} />
      {canWrite ? (
        <RouteForm base={base} policies={policies} catalog={catalog} onDone={done} />
      ) : null}
      <PoliciesSection base={base} policies={policies} canWrite={canWrite} onDone={done} />
    </>
  );
}

function RoutesSection({
  base,
  routes,
  canWrite,
  onDone,
}: {
  base: string;
  routes: RouteSummary[];
  canWrite: boolean;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('routes');
  const locale = useLocale() as Locale;
  const [openId, setOpenId] = useState<string>();
  const [detail, setDetail] = useState<RouteDetail>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();

  async function toggle(id: string): Promise<void> {
    if (openId === id) {
      setOpenId(undefined);
      return;
    }
    setOpenId(id);
    setDetail(undefined);
    const result = await api<RouteDetail>(`${base}/routes/${id}`);
    if (result.ok) {
      setDetail(result.data);
    } else {
      setFailure(result);
    }
  }

  async function archive(route: RouteSummary): Promise<void> {
    setBusy(true);
    const result = await api<RouteDetail>(`${base}/routes/${route.id}/archive`, {
      method: 'POST',
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      if (openId === route.id) setDetail(result.data);
      await onDone(t('list.archived', { name: localName(route, locale) }));
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="routes-heading" className="flex flex-col gap-4">
      <h2 id="routes-heading" className="text-xl font-semibold">
        {t('list.title')}
      </h2>
      {failure === undefined ? null : <RouteProblem failure={failure} />}
      {routes.length === 0 ? (
        <p className="text-slate-600">{t('list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routes.map((route) => {
            const name = localName(route, locale);
            return (
              <li key={route.id}>
                <article
                  aria-label={name}
                  className="flex flex-col gap-3 rounded-md border border-brand-100 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="font-semibold">{name}</h3>
                      <p className="text-sm text-slate-600">
                        {route.stops.map((stop) => localName(stop.city, locale)).join(' – ')}
                      </p>
                      <p className="text-sm text-slate-600">
                        {t('list.summary', {
                          stops: String(route.stops.length),
                          policy: route.cancellationPolicy.name,
                          trips: String(route.tripCount),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          route.status === 'ARCHIVED'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {t(`status.${route.status}`)}
                      </span>
                      {route.status === 'ACTIVE' && !route.editable ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                          {t('list.locked')}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        aria-expanded={openId === route.id}
                        onClick={() => void toggle(route.id)}
                      >
                        {openId === route.id ? t('list.hide') : t('list.show')}
                      </button>
                      {canWrite && route.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON}
                          disabled={busy}
                          onClick={() => void archive(route)}
                        >
                          {t('list.archive')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {openId === route.id ? (
                    detail?.id === route.id ? (
                      <RouteDetailView route={detail} />
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
    </section>
  );
}

function RouteDetailView({ route }: { route: RouteDetail }): ReactNode {
  const t = useTranslations('routes.detail');
  const locale = useLocale() as Locale;
  const names = route.stops.map((stop) => localName(stop.station, locale));
  const [current, ...upcoming] = route.fareSets;
  const amounts = new Map(
    (current?.items ?? []).map((item) => [pairKey(item.fromSeq, item.toSeq), item.amountMinor]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('stops')}</h4>
        <ol className="list-decimal ps-6 text-sm">
          {route.stops.map((stop) => (
            <li key={stop.id}>
              {localName(stop.station, locale)}{' '}
              <span className="text-slate-500">({localName(stop.city, locale)})</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('fares')}</h4>
        {current === undefined ? (
          <p className="text-sm text-amber-900">{t('noFares')}</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {current.validUntil === null
                ? t('validFrom', { from: formatCalendarDay(current.validFrom, locale) })
                : t('validRange', {
                    from: formatCalendarDay(current.validFrom, locale),
                    until: formatCalendarDay(current.validUntil, locale),
                  })}
            </p>
            <FareTable
              names={names}
              caption={t('matrix', { name: localName(route, locale) })}
              cell={(from, to) => {
                const amount = amounts.get(pairKey(from, to));
                return amount === undefined ? '–' : formatFare(amount, current.currency, locale);
              }}
            />
            {upcoming.map((set) => (
              <p key={set.validFrom} className="text-sm text-slate-600">
                {t('upcoming', { from: formatCalendarDay(set.validFrom, locale) })}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Tarifmatrix als Tabelle: Zeilen sind Einstiegshalte, Spalten Ausstiegshalte. Nur Zellen in
 * Fahrtrichtung (Spalte nach Zeile) haben einen Inhalt.
 */
function FareTable({
  names,
  caption,
  cell,
}: {
  names: string[];
  caption: string;
  cell: (from: number, to: number) => ReactNode;
}): ReactNode {
  const t = useTranslations('routes.detail');
  const rows = names.slice(0, -1);
  const columns = names.slice(1);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="border border-brand-100 bg-brand-50 p-2 text-start text-xs">
              {t('corner')}
            </th>
            {columns.map((name, index) => (
              <th
                key={`to-${String(index)}`}
                scope="col"
                className="border border-brand-100 bg-brand-50 p-2 text-start font-medium"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((name, from) => (
            <tr key={`from-${String(from)}`}>
              <th
                scope="row"
                className="border border-brand-100 bg-brand-50 p-2 text-start font-medium"
              >
                {name}
              </th>
              {columns.map((_, index) => {
                const to = index + 1;
                return (
                  <td
                    key={pairKey(from, to)}
                    className="border border-brand-100 p-2 text-end tabular-nums"
                  >
                    {to > from ? cell(from, to) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface StopChoice {
  id: string;
  name: string;
}

function RouteForm({
  base,
  policies,
  catalog,
  onDone,
}: {
  base: string;
  policies: Policy[];
  catalog: CatalogCity[];
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('routes.form');
  const tl = useTranslations('routes.list');
  const locale = useLocale() as Locale;
  const [cityId, setCityId] = useState('');
  const [stationId, setStationId] = useState('');
  const [stops, setStops] = useState<StopChoice[]>([]);
  const [fares, setFares] = useState<Record<string, string>>({});
  const [legs, setLegs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [showMissing, setShowMissing] = useState(false);

  const cities = catalog.filter((city) => city.stations.length > 0);
  const city = cities.find((entry) => entry.id === cityId);
  const available = (city?.stations ?? []).filter(
    (station) => !stops.some((stop) => stop.id === station.id),
  );
  const draft = fareMatrixDraft(stops.length, fares, 'SYP');

  /** Neue Halte machen die bisherigen Preise bedeutungslos; Matrix und Abschnitte neu beginnen. */
  function changeStops(next: StopChoice[]): void {
    setStops(next);
    setFares({});
    setLegs(Array.from({ length: Math.max(next.length - 1, 0) }, () => ''));
    setShowMissing(false);
  }

  function addStop(): void {
    const station = available.find((entry) => entry.id === stationId) ?? available[0];
    if (station === undefined || city === undefined) return;
    const name = localName(station, locale);
    changeStops([
      ...stops,
      { id: station.id, name: station.own ? t('ownStation', { name }) : name },
    ]);
    setStationId('');
  }

  function move(index: number, delta: -1 | 1): void {
    const next = [...stops];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + delta, 0, moved);
    changeStops(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (stops.length < ROUTE_LIMITS.minStops || draft.missing.length > 0) {
      setShowMissing(true);
      return;
    }
    setBusy(true);
    const result = await api<RouteDetail>(`${base}/routes`, {
      method: 'POST',
      body: {
        nameAr: formText(data, 'nameAr'),
        nameEn: formText(data, 'nameEn'),
        cancellationPolicyId: formText(data, 'cancellationPolicyId'),
        stops: stops.map((stop) => stop.id),
        fares: { currency: 'SYP', items: draft.items },
      },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      form.reset();
      changeStops([]);
      setCityId('');
      await onDone(tl('created', { name: localName(result.data, locale) }));
    } else {
      setFailure(result);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="route-form-heading"
      className="flex flex-col gap-5 rounded-md border border-brand-100 bg-white p-4"
    >
      <h2 id="route-form-heading" className="text-xl font-semibold">
        {t('title')}
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label={t('nameAr')}
          name="nameAr"
          required
          lang="ar"
          dir="rtl"
          maxLength={ROUTE_LIMITS.maxNameLength}
          autoComplete="off"
        />
        <Field
          label={t('nameEn')}
          name="nameEn"
          required
          lang="en"
          dir="ltr"
          maxLength={ROUTE_LIMITS.maxNameLength}
          autoComplete="off"
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('policy')}</span>
          <select name="cancellationPolicyId" required className={SELECT}>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">{t('stops')}</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('city')}</span>
            <select
              value={cityId}
              onChange={(event) => {
                setCityId(event.target.value);
                setStationId('');
              }}
              className={SELECT}
            >
              <option value="">{t('chooseCity')}</option>
              {cities.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {localName(entry, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('station')}</span>
            <select
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              disabled={available.length === 0}
              className={`${SELECT} min-w-48`}
            >
              {available.map((station) => {
                const name = localName(station, locale);
                return (
                  <option key={station.id} value={station.id}>
                    {station.own ? t('ownStation', { name }) : name}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={available.length === 0 || stops.length >= ROUTE_LIMITS.maxStops}
            onClick={addStop}
          >
            {t('addStop')}
          </button>
        </div>
        {stops.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noStops')}</p>
        ) : (
          <ol className="flex flex-col gap-1" aria-label={t('stops')}>
            {stops.map((stop, index) => (
              <li
                key={stop.id}
                className="flex flex-wrap items-center gap-2 rounded-md bg-brand-50 px-3 py-1.5 text-sm"
              >
                <span className="min-w-6 font-semibold tabular-nums">{index + 1}.</span>
                <span className="grow">{stop.name}</span>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  disabled={index === 0}
                  aria-label={t('moveUp', { name: stop.name })}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  disabled={index === stops.length - 1}
                  aria-label={t('moveDown', { name: stop.name })}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  aria-label={t('remove', { name: stop.name })}
                  onClick={() => changeStops(stops.filter((entry) => entry.id !== stop.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        {showMissing && stops.length < ROUTE_LIMITS.minStops ? (
          <Alert>{t('minStops', { min: String(ROUTE_LIMITS.minStops) })}</Alert>
        ) : null}
      </fieldset>

      {stops.length >= ROUTE_LIMITS.minStops ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-medium">{t('fares')}</legend>
          <p className="text-xs text-slate-500">{t('faresHint')}</p>
          <div className="flex flex-col gap-2 rounded-md bg-brand-50 p-3">
            <h3 className="text-sm font-medium">{t('legs')}</h3>
            <div className="flex flex-wrap items-end gap-3">
              {legs.map((value, index) => (
                <label key={`leg-${String(index)}`} className="flex flex-col gap-1">
                  <span className="text-xs">
                    {t('leg', {
                      from: stops[index]?.name ?? '',
                      to: stops[index + 1]?.name ?? '',
                    })}
                  </span>
                  <input
                    value={value}
                    inputMode="numeric"
                    dir="ltr"
                    onChange={(event) =>
                      setLegs(legs.map((leg, at) => (at === index ? event.target.value : leg)))
                    }
                    className={AMOUNT_INPUT}
                  />
                </label>
              ))}
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => setFares({ ...fares, ...suggestFares(legs) })}
              >
                {t('applySuggestion')}
              </button>
            </div>
          </div>
          <FareTable
            names={stops.map((stop) => stop.name)}
            caption={t('fares')}
            cell={(from, to) => (
              <input
                value={fares[pairKey(from, to)] ?? ''}
                inputMode="numeric"
                dir="ltr"
                aria-label={t('fareFor', {
                  from: stops[from]?.name ?? '',
                  to: stops[to]?.name ?? '',
                })}
                onChange={(event) =>
                  setFares({ ...fares, [pairKey(from, to)]: event.target.value })
                }
                className={AMOUNT_INPUT}
              />
            )}
          />
          {showMissing && draft.missing.length > 0 ? (
            <Alert>{t('missing', { count: String(draft.missing.length) })}</Alert>
          ) : null}
        </fieldset>
      ) : null}

      {failure === undefined ? null : (
        <RouteProblem failure={failure} stopName={(seq) => stops[seq]?.name ?? String(seq + 1)} />
      )}
      <div>
        <SubmitButton busy={busy || policies.length === 0}>{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}

function PoliciesSection({
  base,
  policies,
  canWrite,
  onDone,
}: {
  base: string;
  policies: Policy[];
  canWrite: boolean;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('routes.policies');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();

  async function createStandard(): Promise<void> {
    setBusy(true);
    const result = await api<Policy>(`${base}/cancellation-policies`, {
      method: 'POST',
      body: { name: t('standardName'), allowPassengerCancel: true, rules: STANDARD_POLICY_RULES },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      await onDone(t('created', { name: result.data.name }));
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="policies-heading" className="flex flex-col gap-4">
      <h2 id="policies-heading" className="text-xl font-semibold">
        {t('title')}
      </h2>
      {failure === undefined ? null : <RouteProblem failure={failure} />}
      {policies.length === 0 ? (
        <p className="text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {policies.map((policy) => (
            <li key={policy.id}>
              <article
                aria-label={policy.name}
                className="flex flex-col gap-1 rounded-md border border-brand-100 bg-white p-4 text-sm"
              >
                <h3 className="font-semibold">{policy.name}</h3>
                <p className="text-slate-600">
                  {policy.allowPassengerCancel ? t('passengerCancel') : t('noPassengerCancel')}
                </p>
                <ul className="list-disc ps-5">
                  {policy.rules.map((rule) => (
                    <li key={rule.minMinutesBeforeDeparture}>
                      {t('rule', {
                        hours: String(Math.round((rule.minMinutesBeforeDeparture / 60) * 10) / 10),
                        percent: String(rule.feeBps / 100),
                      })}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="flex flex-col gap-2 rounded-md border border-brand-100 bg-white p-4">
          <h3 className="font-semibold">{t('standardTitle')}</h3>
          <p className="text-sm text-slate-600">{t('standardText')}</p>
          <div>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => void createStandard()}
            >
              {t('createStandard')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
