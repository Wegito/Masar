'use client';

import {
  GENERATED_SEAT_LAYOUT_PATTERNS,
  type GeneratedSeatLayoutPattern,
  SEAT_LAYOUT_LIMITS,
} from '@masar/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { api, formText, type Problem } from '../../../../lib/api';
import type { Bus, LayoutDetail, LayoutPreview, LayoutSummary } from '../../../../lib/fleet';
import { SeatMapView } from './seat-map-view';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/** Codes mit eigenem Text im Bereich Flotte; alles andere übersetzt ProblemMessage. */
const FLEET_CODES = new Set([
  'SEAT_LAYOUT_NOT_FOUND',
  'SEAT_LAYOUT_NAME_TAKEN',
  'SEAT_LAYOUT_IN_USE',
  'SEAT_LAYOUT_RETIRED',
  'BUS_NOT_FOUND',
  'BUS_PLATE_TAKEN',
  'BUS_IN_USE',
]);

const PREVIEW_DELAY_MS = 300;
const SELECT =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const SECONDARY_BUTTON =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60';

function FleetProblem({ failure }: { failure: Failure }): ReactNode {
  const t = useTranslations('fleet.errors');
  const { problem } = failure;
  if (problem.code === 'VALIDATION_FAILED' && problem.errors?.some((e) => e.path === 'plate')) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {t('plateInvalid')}
      </p>
    );
  }
  if (FLEET_CODES.has(problem.code)) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {t(problem.code)}
      </p>
    );
  }
  return <ProblemMessage {...failure} />;
}

/**
 * Sitzpläne und Busse einer Firma. Die Firma steht nur im Pfad der API; ob die Person dort
 * schreiben darf, prüft die API selbst. `canWrite` blendet Formulare und Aktionen nur aus.
 */
export function FleetManager({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}): ReactNode {
  const t = useTranslations('fleet');
  const [layouts, setLayouts] = useState<LayoutSummary[]>();
  const [buses, setBuses] = useState<Bus[]>();
  const [loadFailure, setLoadFailure] = useState<Failure>();
  const [notice, setNotice] = useState<string>();
  const base = `/companies/${companyId}`;

  const reload = useCallback(async (): Promise<void> => {
    const [layoutResult, busResult] = await Promise.all([
      api<{ items: LayoutSummary[] }>(`${base}/seat-layouts`),
      api<{ items: Bus[] }>(`${base}/buses`),
    ]);
    if (!layoutResult.ok) {
      setLoadFailure(layoutResult);
      return;
    }
    if (!busResult.ok) {
      setLoadFailure(busResult);
      return;
    }
    setLoadFailure(undefined);
    setLayouts(layoutResult.data.items);
    setBuses(busResult.data.items);
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
    return <FleetProblem failure={loadFailure} />;
  }
  if (layouts === undefined || buses === undefined) {
    return <p className="text-slate-600">{t('loading')}</p>;
  }

  return (
    <>
      {notice === undefined ? null : (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      {canWrite ? null : (
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{t('readOnly')}</p>
      )}
      <LayoutsSection base={base} layouts={layouts} canWrite={canWrite} onDone={done} />
      <BusesSection base={base} buses={buses} layouts={layouts} canWrite={canWrite} onDone={done} />
    </>
  );
}

function LayoutsSection({
  base,
  layouts,
  canWrite,
  onDone,
}: {
  base: string;
  layouts: LayoutSummary[];
  canWrite: boolean;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('fleet');
  const [openId, setOpenId] = useState<string>();
  const [detail, setDetail] = useState<LayoutDetail>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();

  async function toggle(id: string): Promise<void> {
    if (openId === id) {
      setOpenId(undefined);
      return;
    }
    setOpenId(id);
    setDetail(undefined);
    const result = await api<LayoutDetail>(`${base}/seat-layouts/${id}`);
    if (result.ok) {
      setDetail(result.data);
    } else {
      setFailure(result);
    }
  }

  async function archive(layout: LayoutSummary): Promise<void> {
    setBusy(true);
    const result = await api<LayoutDetail>(`${base}/seat-layouts/${layout.id}/archive`, {
      method: 'POST',
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      await onDone(t('layouts.archived', { name: layout.name }));
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="layouts-heading" className="flex flex-col gap-4">
      <h2 id="layouts-heading" className="text-xl font-semibold">
        {t('layouts.title')}
      </h2>
      {failure === undefined ? null : <FleetProblem failure={failure} />}
      {layouts.length === 0 ? (
        <p className="text-slate-600">{t('layouts.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {layouts.map((layout) => (
            <li key={layout.id}>
              <article
                aria-label={layout.name}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-semibold">
                      {layout.name}{' '}
                      <span className="text-sm font-normal text-slate-500">
                        {t('layouts.version', { version: String(layout.version) })}
                      </span>
                    </h3>
                    <p className="text-sm text-slate-600">
                      {t(`patterns.${layout.pattern}`)} ·{' '}
                      {t('layouts.seats', { count: String(layout.seatCount) })} ·{' '}
                      {t('layouts.usage', {
                        buses: String(layout.busCount),
                        trips: String(layout.tripCount),
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        layout.status === 'RETIRED'
                          ? 'bg-slate-200 text-slate-700'
                          : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {t(`layoutStatus.${layout.status}`)}
                    </span>
                    {layout.status !== 'RETIRED' && !layout.editable ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                        {t('layouts.locked')}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      aria-expanded={openId === layout.id}
                      onClick={() => void toggle(layout.id)}
                    >
                      {openId === layout.id ? t('layouts.hide') : t('layouts.show')}
                    </button>
                    {canWrite && layout.status !== 'RETIRED' ? (
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        disabled={busy}
                        onClick={() => void archive(layout)}
                      >
                        {t('layouts.archive')}
                      </button>
                    ) : null}
                  </div>
                </div>
                {openId === layout.id ? (
                  detail?.id === layout.id ? (
                    <SeatMapView
                      seats={detail.seats}
                      neighbors={detail.neighbors}
                      label={t('map.label', { name: layout.name })}
                    />
                  ) : (
                    <p className="text-sm text-slate-600">{t('loading')}</p>
                  )
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? <LayoutForm base={base} onDone={onDone} /> : null}
    </section>
  );
}

interface Spec {
  pattern: GeneratedSeatLayoutPattern;
  rows: number;
  backBench?: number;
}

/** Werte des Formulars als Generator-Eingabe; `null`, solange sie außerhalb der Grenzen liegen. */
function readSpec(pattern: string, rows: string, withBench: boolean, bench: string): Spec | null {
  const rowCount = Number(rows);
  const benchCount = Number(bench);
  if (
    !(GENERATED_SEAT_LAYOUT_PATTERNS as readonly string[]).includes(pattern) ||
    !Number.isInteger(rowCount) ||
    rowCount < SEAT_LAYOUT_LIMITS.minRows ||
    rowCount > SEAT_LAYOUT_LIMITS.maxRows ||
    (withBench &&
      (!Number.isInteger(benchCount) ||
        benchCount < SEAT_LAYOUT_LIMITS.minBackBench ||
        benchCount > SEAT_LAYOUT_LIMITS.maxBackBench))
  ) {
    return null;
  }
  return {
    pattern: pattern as GeneratedSeatLayoutPattern,
    rows: rowCount,
    ...(withBench ? { backBench: benchCount } : {}),
  };
}

function LayoutForm({
  base,
  onDone,
}: {
  base: string;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('fleet');
  const [pattern, setPattern] = useState<string>('TWO_PLUS_TWO');
  const [rows, setRows] = useState('10');
  const [withBench, setWithBench] = useState(true);
  const [bench, setBench] = useState('5');
  const [preview, setPreview] = useState<LayoutPreview | null>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const spec = readSpec(pattern, rows, withBench, bench);
  const specKey = spec === null ? null : JSON.stringify(spec);

  // Vorschau über dieselbe Funktion wie beim Anlegen (API), verzögert während der Eingabe.
  useEffect(() => {
    if (specKey === null) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api<LayoutPreview>(`${base}/seat-layouts/preview`, {
        method: 'POST',
        body: JSON.parse(specKey) as Spec,
      }).then((result) => {
        if (!cancelled) setPreview(result.ok ? result.data : null);
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, specKey]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const name = formText(new FormData(form), 'name');
    if (spec === null) {
      return;
    }
    setBusy(true);
    const result = await api<LayoutDetail>(`${base}/seat-layouts`, {
      method: 'POST',
      body: { name, ...spec },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      form.reset();
      await onDone(t('layouts.created', { name: result.data.name }));
    } else {
      setFailure(result);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="layout-form-heading"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h3 id="layout-form-heading" className="font-semibold">
        {t('layoutForm.title')}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field
            label={t('layoutForm.name')}
            name="name"
            required
            maxLength={SEAT_LAYOUT_LIMITS.maxNameLength}
            autoComplete="off"
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('layoutForm.pattern')}</span>
            <select
              name="pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              className={SELECT}
            >
              {GENERATED_SEAT_LAYOUT_PATTERNS.map((value) => (
                <option key={value} value={value}>
                  {t(`patterns.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t('layoutForm.rows')}
            hint={t('layoutForm.rowsHint', {
              min: String(SEAT_LAYOUT_LIMITS.minRows),
              max: String(SEAT_LAYOUT_LIMITS.maxRows),
            })}
            name="rows"
            type="number"
            inputMode="numeric"
            dir="ltr"
            required
            min={SEAT_LAYOUT_LIMITS.minRows}
            max={SEAT_LAYOUT_LIMITS.maxRows}
            value={rows}
            onChange={(event) => setRows(event.target.value)}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="withBench"
              checked={withBench}
              onChange={(event) => setWithBench(event.target.checked)}
              className="size-4"
            />
            <span className="text-sm font-medium">{t('layoutForm.withBench')}</span>
          </label>
          {withBench ? (
            <Field
              label={t('layoutForm.bench')}
              hint={t('layoutForm.benchHint', {
                min: String(SEAT_LAYOUT_LIMITS.minBackBench),
                max: String(SEAT_LAYOUT_LIMITS.maxBackBench),
              })}
              name="backBench"
              type="number"
              inputMode="numeric"
              dir="ltr"
              required
              min={SEAT_LAYOUT_LIMITS.minBackBench}
              max={SEAT_LAYOUT_LIMITS.maxBackBench}
              value={bench}
              onChange={(event) => setBench(event.target.value)}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-2" aria-live="polite">
          <h4 className="text-sm font-medium">{t('layoutForm.preview')}</h4>
          {spec === null ? (
            <p className="text-sm text-amber-900">{t('layoutForm.previewInvalid')}</p>
          ) : preview === undefined ? (
            <p className="text-sm text-slate-600">{t('loading')}</p>
          ) : preview === null ? (
            <p className="text-sm text-red-800">{t('layoutForm.previewFailed')}</p>
          ) : (
            <>
              <p className="text-sm text-slate-700" data-testid="preview-summary">
                {t('layoutForm.previewSummary', {
                  seats: String(preview.seatCount),
                  pairs: String(preview.neighbors.length),
                })}
              </p>
              <SeatMapView
                seats={preview.seats}
                neighbors={preview.neighbors}
                label={t('layoutForm.preview')}
              />
            </>
          )}
        </div>
      </div>
      {failure === undefined ? null : <FleetProblem failure={failure} />}
      <div>
        <SubmitButton busy={busy || spec === null}>{t('layoutForm.submit')}</SubmitButton>
      </div>
    </form>
  );
}

function BusesSection({
  base,
  buses,
  layouts,
  canWrite,
  onDone,
}: {
  base: string;
  buses: Bus[];
  layouts: LayoutSummary[];
  canWrite: boolean;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('fleet');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const assignable = layouts.filter((layout) => layout.status !== 'RETIRED');

  async function setStatus(bus: Bus, action: 'activate' | 'deactivate'): Promise<void> {
    setBusy(true);
    const result = await api<Bus>(`${base}/buses/${bus.id}/${action}`, { method: 'POST' });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      await onDone(
        t(action === 'deactivate' ? 'buses.deactivated' : 'buses.activated', {
          plate: bus.plate,
        }),
      );
    } else {
      setFailure(result);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const result = await api<Bus>(`${base}/buses`, {
      method: 'POST',
      body: { plate: formText(data, 'plate'), seatLayoutId: formText(data, 'seatLayoutId') },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      form.reset();
      await onDone(t('buses.created', { plate: result.data.plate }));
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="buses-heading" className="flex flex-col gap-4">
      <h2 id="buses-heading" className="text-xl font-semibold">
        {t('buses.title')}
      </h2>
      {failure === undefined ? null : <FleetProblem failure={failure} />}
      {buses.length === 0 ? (
        <p className="text-slate-600">{t('buses.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {buses.map((bus) => (
            <li key={bus.id}>
              <article
                aria-label={bus.plate}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-semibold">
                    <bdi>{bus.plate}</bdi>
                  </h3>
                  <p className="text-sm text-slate-600">
                    {t('buses.layout', {
                      name: bus.seatLayout.name,
                      version: String(bus.seatLayout.version),
                      seats: String(bus.seatLayout.seatCount),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      bus.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {t(`busStatus.${bus.status}`)}
                  </span>
                  {canWrite ? (
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      disabled={busy}
                      onClick={() =>
                        void setStatus(bus, bus.status === 'ACTIVE' ? 'deactivate' : 'activate')
                      }
                    >
                      {bus.status === 'ACTIVE' ? t('buses.deactivate') : t('buses.activate')}
                    </button>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          onSubmit={(event) => void submit(event)}
          aria-labelledby="bus-form-heading"
          className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
        >
          <h3 id="bus-form-heading" className="font-semibold">
            {t('busForm.title')}
          </h3>
          {assignable.length === 0 ? (
            <p className="text-sm text-slate-600">{t('busForm.needLayout')}</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t('busForm.plate')}
                  hint={t('busForm.plateHint')}
                  name="plate"
                  required
                  maxLength={40}
                  autoComplete="off"
                />
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t('busForm.layout')}</span>
                  <select name="seatLayoutId" required className={SELECT}>
                    {assignable.map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {t('busForm.layoutOption', {
                          name: layout.name,
                          version: String(layout.version),
                          seats: String(layout.seatCount),
                        })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <SubmitButton busy={busy}>{t('busForm.submit')}</SubmitButton>
              </div>
            </>
          )}
        </form>
      ) : null}
    </section>
  );
}
