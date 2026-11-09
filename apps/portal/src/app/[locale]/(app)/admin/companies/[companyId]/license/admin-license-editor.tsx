'use client';

import { LICENSE_PLANS, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

import { Field, SubmitButton } from '../../../../../../../components/field';
import { ProblemMessage } from '../../../../../../../components/problem-message';
import { api, type Problem } from '../../../../../../../lib/api';
import {
  type AdminLicenseView,
  createLicenseBody,
  type LicenseDraft,
  type LicenseDraftField,
  updateLicenseBody,
} from '../../../../../../../lib/license';
import { localName } from '../../../../../../../lib/routes';
import { LicenseOverview, PeriodTable } from '../../../../license/license-overview';

const KNOWN_CODES = new Set([
  'LICENSE_PERIOD_OVERLAP',
  'LICENSE_NOT_FOUND',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'SERVICE_UNAVAILABLE',
]);

const SELECT =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

const EMPTY_DRAFT: LicenseDraft = {
  plan: '',
  validFrom: '',
  validUntil: '',
  busPackages: '',
  notes: '',
};

function LicenseProblem({ problem }: { problem: Problem }): ReactNode {
  const t = useTranslations('admin.license.errors');
  if (!KNOWN_CODES.has(problem.code)) {
    return <ProblemMessage problem={problem} />;
  }
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      {t(problem.code)}
    </p>
  );
}

/**
 * Pflege der Lizenz einer Firma durch den Plattform-Admin: Stand wie die Firma ihn sieht, alle
 * Zeiträume mit Notiz, den heutigen Zeitraum ändern (`PUT`) und einen neuen Zeitraum anlegen
 * (`POST`, auch Verlängerung). Prüfung der Eingaben in `lib/license.ts`, Regeln in der API.
 */
export function AdminLicenseEditor({ companyId }: { companyId: string }): ReactNode {
  const t = useTranslations('admin');
  const locale = useLocale() as Locale;
  const path = `/admin/companies/${companyId}/license`;
  const [license, setLicense] = useState<AdminLicenseView>();
  const [loadProblem, setLoadProblem] = useState<Problem>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    const result = await api<AdminLicenseView>(path);
    if (result.ok) {
      setLicense(result.data);
      setLoadProblem(undefined);
    } else {
      setLoadProblem(result.problem);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadProblem !== undefined) {
    return <LicenseProblem problem={loadProblem} />;
  }
  if (license === undefined) {
    return <p className="text-slate-600">{t('loading')}</p>;
  }

  const done = (data: AdminLicenseView, message: string): void => {
    setLicense(data);
    setNotice(message);
  };

  return (
    <>
      <h1 className="text-2xl font-bold">
        {t('license.title', { company: localName(license.company, locale) })}
      </h1>
      {notice === undefined ? null : (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      <LicenseOverview license={{ ...license, periods: [] }} />
      <PeriodTable periods={license.periods} notes={t('license.noteColumn')} />
      {/* Neuer Schlüssel je Stand: Das Formular übernimmt die aktuellen Werte nach dem Speichern. */}
      <EditForm
        key={`${license.periodId ?? 'none'}-${JSON.stringify(license.periods)}`}
        path={path}
        license={license}
        onDone={done}
      />
      <CreateForm path={path} onDone={done} />
    </>
  );
}

function EditForm({
  path,
  license,
  onDone,
}: {
  path: string;
  license: AdminLicenseView;
  onDone: (data: AdminLicenseView, message: string) => void;
}): ReactNode {
  const t = useTranslations('admin.license');
  const current = license.periods.find((period) => period.id === license.periodId);
  const [draft, setDraft] = useState({
    validFrom: current?.validFrom ?? '',
    validUntil: current?.validUntil ?? '',
    busPackages: current === undefined ? '' : String(current.busPackages),
    notes: current?.notes ?? '',
  });
  const [invalid, setInvalid] = useState<LicenseDraftField>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);

  if (current === undefined) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (current === undefined) return;
    const built = updateLicenseBody(draft, current);
    if (!built.ok) {
      setInvalid(built.field);
      return;
    }
    setInvalid(undefined);
    if (Object.keys(built.body).length === 0) {
      onDone(license, t('nothingChanged'));
      return;
    }
    setBusy(true);
    const result = await api<AdminLicenseView>(path, { method: 'PUT', body: built.body });
    setBusy(false);
    if (result.ok) {
      setProblem(undefined);
      onDone(result.data, t('saved'));
    } else {
      setProblem(result.problem);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="license-edit"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="license-edit" className="text-xl font-semibold">
          {t('editTitle')}
        </h2>
        <p className="text-sm text-slate-600">{t('editHint')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label={t('busPackages')}
          value={draft.busPackages}
          onChange={(event) => setDraft({ ...draft, busPackages: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <Field
          label={t('validFromEdit')}
          value={draft.validFrom}
          onChange={(event) => setDraft({ ...draft, validFrom: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <Field
          label={t('validUntil')}
          value={draft.validUntil}
          onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <div className="md:col-span-3">
          <Field
            label={t('notes')}
            hint={t('notesHint')}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
      {invalid === undefined ? null : (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {t(`invalid.${invalid}`)}
        </p>
      )}
      {problem === undefined ? null : <LicenseProblem problem={problem} />}
      <div>
        <SubmitButton busy={busy}>{t('save')}</SubmitButton>
      </div>
    </form>
  );
}

function CreateForm({
  path,
  onDone,
}: {
  path: string;
  onDone: (data: AdminLicenseView, message: string) => void;
}): ReactNode {
  const t = useTranslations('admin.license');
  const tPlan = useTranslations('license.plan');
  const [draft, setDraft] = useState<LicenseDraft>(EMPTY_DRAFT);
  const [invalid, setInvalid] = useState<LicenseDraftField>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const built = createLicenseBody(draft);
    if (!built.ok) {
      setInvalid(built.field);
      return;
    }
    setInvalid(undefined);
    setBusy(true);
    const result = await api<AdminLicenseView>(path, { method: 'POST', body: built.body });
    setBusy(false);
    if (result.ok) {
      setProblem(undefined);
      setDraft(EMPTY_DRAFT);
      onDone(result.data, t('created'));
    } else {
      setProblem(result.problem);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="license-create"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="license-create" className="text-xl font-semibold">
          {t('createTitle')}
        </h2>
        <p className="text-sm text-slate-600">{t('createHint')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('plan')}</span>
          <select
            value={draft.plan}
            onChange={(event) =>
              setDraft({ ...draft, plan: event.target.value as LicenseDraft['plan'] })
            }
            className={SELECT}
          >
            <option value="">{t('choosePlan')}</option>
            {LICENSE_PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {tPlan(plan)}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t('busPackagesOptional')}
          value={draft.busPackages}
          onChange={(event) => setDraft({ ...draft, busPackages: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <Field
          label={t('validFrom')}
          value={draft.validFrom}
          onChange={(event) => setDraft({ ...draft, validFrom: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <Field
          label={t('validUntilOptional')}
          value={draft.validUntil}
          onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })}
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
        />
        <div className="md:col-span-2">
          <Field
            label={t('notes')}
            hint={t('notesHint')}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
      {invalid === undefined ? null : (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {t(`invalid.${invalid}`)}
        </p>
      )}
      {problem === undefined ? null : <LicenseProblem problem={problem} />}
      <div>
        <SubmitButton busy={busy}>{t('create')}</SubmitButton>
      </div>
    </form>
  );
}
