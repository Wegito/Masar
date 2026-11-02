'use client';

import type { Gender, Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from 'react';

import { type Audience, holdSeats, type HoldState } from '../app/[locale]/trips/[tripId]/actions';
import {
  CONTACT_NAME_FIELD,
  EMAIL_FIELD,
  type FieldError,
  isBookingProblem,
  isSeatProblem,
  passengerField,
  payHref,
  PHONE_FIELD,
} from '../lib/booking';
import { formatFare } from '../lib/format';
import type { MoneyView } from '../lib/types';
import { ProblemNotice } from './problem-notice';

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg aria-invalid:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const FOCUS_RING =
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600';

const initial: HoldState = { status: 'idle' };

/** Eingaben des Formulars; leben nur im Speicher der Seite, damit „Sitze ändern" sie behält. */
export type Draft = Record<string, string>;

export interface SeatProblem {
  code: string;
  seats: string[];
}

export interface PassengerFormProps {
  tripId: string;
  fromStopId: string;
  toStopId: string;
  seats: { seatId: string; label: string }[];
  /** Gewählte Gruppe vor der Sitzwahl; `null` ohne Geschlechtsregel. */
  audience: Audience | null;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  companyName: string;
  fare: MoneyView;
  idempotencyKey: string;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  /** Zurück zur Sitzwahl; mit Problem lädt der Sitzplan neu und erklärt, warum. */
  onBack: (problem: SeatProblem | null) => void;
  /** Neuer `Idempotency-Key`, wenn der alte schon zu einer anderen Auswahl gehört; stabil. */
  onRenewKey: () => void;
}

/**
 * Fahrgastdaten und Kontakt (Schritt 1.5). Ein echtes Formular mit Server Action: Alle Eingaben
 * gehen im POST-Body an den Web-Server, nie in eine URL. Mit JavaScript löst die Seite die Action
 * selbst aus, damit React die Eingaben nach einem Fehler nicht leert. Geprüft wird auf dem Server
 * (Telefon mit `normalizePhone` aus `@masar/shared`); Hinweise erscheinen in der Sprache der Seite,
 * nicht in der des Browsers, deshalb `noValidate`.
 */
export function PassengerForm(props: PassengerFormProps): ReactNode {
  const t = useTranslations('booking');
  const locale = useLocale() as Locale;
  const [state, formAction, pending] = useActionState(holdSeats, initial);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const href = state.status === 'held' ? payHref(locale, state.bookingId, state.token) : null;
  const errorAt = state.status === 'error' ? state.at : null;
  const errorCode = state.status === 'error' ? state.code : null;
  const fields = state.status === 'error' ? state.fields : {};
  const { onBack, onRenewKey } = props;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (href !== null) {
      // Volle Navigation: Die Seite „Zahlweg wählen" liest das Token aus dem Fragment.
      window.location.assign(href);
    }
  }, [href]);

  useEffect(() => {
    if (errorAt === null) {
      return;
    }
    if (errorCode === 'IDEMPOTENCY_KEY_REUSED') {
      onRenewKey();
    }
    summaryRef.current?.focus();
    // Nur je neuer Fehlerantwort; `onRenewKey` ist im Elternteil stabil (useCallback).
  }, [errorAt, errorCode, onRenewKey]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: Draft = {};
    for (const [name, value] of data.entries()) {
      // Nur Eingaben des Fahrgasts (`passengers.*`, `contact.*`), keine versteckten Felder.
      if (typeof value === 'string' && name.includes('.')) {
        draft[name] = value;
      }
    }
    const chosenLocale = data.get('notificationLocale');
    draft.notificationLocale = typeof chosenLocale === 'string' ? chosenLocale : locale;
    props.onDraft(draft);
    startTransition(() => formAction(data));
  }

  const value = (name: string): string | undefined => props.draft[name];
  const defaultGender = (index: number): Gender | undefined => {
    const saved = value(passengerField(index, 'gender'));
    if (saved === 'FEMALE' || saved === 'MALE') return saved;
    return props.audience === 'FEMALE' || props.audience === 'MALE' ? props.audience : undefined;
  };
  const notificationLocale = value('notificationLocale') ?? locale;

  return (
    <section aria-labelledby="details-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2
          id="details-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('detailsHeading')}
        </h2>
        <p className="text-slate-700">{t('detailsIntro')}</p>
        <button
          type="button"
          onClick={() => onBack(null)}
          disabled={pending}
          className="self-start rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('changeSeats')}
        </button>
      </div>

      <div ref={summaryRef} tabIndex={-1} className="focus-visible:outline-none">
        {state.status === 'error' ? (
          <FormProblem
            code={state.code}
            seats={state.seats}
            onBack={() => onBack({ code: state.code, seats: state.seats })}
          />
        ) : null}
      </div>

      <form action={formAction} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <input type="hidden" name="tripId" value={props.tripId} />
        <input type="hidden" name="fromStopId" value={props.fromStopId} />
        <input type="hidden" name="toStopId" value={props.toStopId} />
        <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
        <input type="hidden" name="genderRule" value={props.genderRuleEnabled ? '1' : '0'} />
        <input
          type="hidden"
          name="nationalIdRequired"
          value={props.nationalIdRequired ? '1' : '0'}
        />
        {props.seats.map((seat) => (
          <input key={seat.seatId} type="hidden" name="seatId" value={seat.seatId} />
        ))}

        {props.seats.map((seat, index) => (
          <fieldset
            key={seat.seatId}
            className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4"
          >
            <legend className="px-1 text-lg font-semibold">
              {t('passengerHeading', { number: String(index + 1), label: seat.label })}
            </legend>
            <TextField
              name={passengerField(index, 'fullName')}
              label={t('fullName')}
              hint={t('fullNameHint')}
              error={fields[passengerField(index, 'fullName')]}
              errorText={(error) => t(`fieldErrors.name.${error}`)}
              autoComplete={index === 0 ? 'name' : 'off'}
              maxLength={100}
              defaultValue={value(passengerField(index, 'fullName'))}
            />
            {props.genderRuleEnabled ? (
              <GenderField
                name={passengerField(index, 'gender')}
                defaultValue={defaultGender(index)}
                error={fields[passengerField(index, 'gender')]}
              />
            ) : null}
            {props.nationalIdRequired ? (
              <TextField
                name={passengerField(index, 'nationalId')}
                label={t('nationalId')}
                hint={t('nationalIdHint', { company: props.companyName })}
                error={fields[passengerField(index, 'nationalId')]}
                errorText={(error) => t(`fieldErrors.generic.${error}`)}
                autoComplete="off"
                maxLength={64}
                dir="ltr"
                defaultValue={value(passengerField(index, 'nationalId'))}
              />
            ) : null}
          </fieldset>
        ))}

        <fieldset className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-lg font-semibold">{t('contactHeading')}</legend>
          <p className="text-sm text-slate-600">{t('contactIntro')}</p>
          <TextField
            name={PHONE_FIELD}
            label={t('phone')}
            hint={t.rich('phoneHint', { n: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}
            error={fields[PHONE_FIELD]}
            errorText={(error) => t(`fieldErrors.phone.${error}`)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={40}
            dir="ltr"
            defaultValue={value(PHONE_FIELD)}
          />
          <TextField
            name={EMAIL_FIELD}
            label={t('email')}
            hint={t('emailHint')}
            error={fields[EMAIL_FIELD]}
            errorText={(error) => t(`fieldErrors.email.${error}`)}
            type="email"
            autoComplete="email"
            maxLength={254}
            dir="ltr"
            optional
            defaultValue={value(EMAIL_FIELD)}
          />
          <TextField
            name={CONTACT_NAME_FIELD}
            label={t('contactName')}
            hint={t('contactNameHint')}
            error={fields[CONTACT_NAME_FIELD]}
            errorText={(error) => t(`fieldErrors.name.${error}`)}
            autoComplete="off"
            maxLength={100}
            optional
            defaultValue={value(CONTACT_NAME_FIELD)}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('notificationLocale')}</legend>
            <div className="flex flex-wrap gap-2">
              {(['ar', 'en'] as const).map((option) => (
                <label key={option} className="relative">
                  <input
                    type="radio"
                    name="notificationLocale"
                    value={option}
                    defaultChecked={notificationLocale === option}
                    className="peer sr-only"
                  />
                  <span
                    lang={option}
                    className={`flex min-h-11 cursor-pointer items-center rounded-xl border-2 border-slate-300 bg-white px-4 font-medium peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-900 ${FOCUS_RING}`}
                  >
                    {option === 'ar' ? 'العربية' : 'English'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">
            {t('total', { price: formatFare(props.fare, locale, props.seats.length) })}
          </p>
          <p className="text-sm text-slate-700">{t('holdHint')}</p>
          <button
            type="submit"
            disabled={pending || href !== null}
            className="rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {pending || href !== null ? t('submitting') : t('submit')}
          </button>
          {href === null ? null : (
            <p role="status" className="text-sm text-slate-700">
              {t('held')}{' '}
              <a href={href} className="font-semibold underline">
                {t('openPayment')}
              </a>
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function FormProblem({
  code,
  seats,
  onBack,
}: {
  code: string;
  seats: string[];
  onBack: () => void;
}): ReactNode {
  const t = useTranslations('booking');
  const locale = useLocale() as Locale;
  if (!isBookingProblem(code)) {
    return <ProblemNotice code={code} />;
  }
  const labels = seats.join(locale === 'ar' ? '، ' : ', ');
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl bg-red-50 p-4 text-red-900">
      <p>
        {isSeatProblem(code) && seats.length > 0
          ? t(`seatProblems.${code}`, { seats: labels })
          : t(`problems.${code}`)}
      </p>
      {isSeatProblem(code) ? (
        <button
          type="button"
          onClick={onBack}
          className="self-start rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('backToSeats')}
        </button>
      ) : null}
    </div>
  );
}

function TextField(props: {
  name: string;
  label: string;
  hint: ReactNode;
  error: FieldError | undefined;
  errorText: (error: FieldError) => string;
  type?: 'text' | 'tel' | 'email';
  inputMode?: 'tel' | 'email' | 'text';
  autoComplete: string;
  maxLength: number;
  dir?: 'ltr';
  optional?: boolean;
  defaultValue: string | undefined;
}): ReactNode {
  const id = `field-${props.name.replace(/\./g, '-')}`;
  const describedBy = `${id}-hint${props.error === undefined ? '' : ` ${id}-error`}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {props.label}
      </label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        {...(props.inputMode === undefined ? {} : { inputMode: props.inputMode })}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        required={props.optional !== true}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={describedBy}
        spellCheck={false}
        {...(props.dir === undefined ? {} : { dir: props.dir })}
        defaultValue={props.defaultValue}
        className={`${FIELD} text-start`}
      />
      <span id={`${id}-hint`} className="text-sm text-slate-600">
        {props.hint}
      </span>
      {props.error === undefined ? null : (
        <span id={`${id}-error`} className="text-sm font-medium text-red-700">
          {props.errorText(props.error)}
        </span>
      )}
    </div>
  );
}

function GenderField(props: {
  name: string;
  defaultValue: Gender | undefined;
  error: FieldError | undefined;
}): ReactNode {
  const t = useTranslations('booking');
  const id = `field-${props.name.replace(/\./g, '-')}`;
  return (
    <fieldset
      aria-describedby={`${id}-hint${props.error === undefined ? '' : ` ${id}-error`}`}
      className="flex flex-col gap-2"
    >
      <legend className="mb-1 font-medium">{t('gender')}</legend>
      <div className="flex flex-wrap gap-2">
        {(['FEMALE', 'MALE'] as const).map((option) => (
          <label key={option} className="relative">
            <input
              type="radio"
              name={props.name}
              value={option}
              required
              defaultChecked={props.defaultValue === option}
              className="peer sr-only"
            />
            <span
              className={`flex min-h-11 cursor-pointer items-center rounded-xl border-2 border-slate-300 bg-white px-4 font-medium peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-900 ${FOCUS_RING}`}
            >
              {t(`genders.${option}`)}
            </span>
          </label>
        ))}
      </div>
      <span id={`${id}-hint`} className="text-sm text-slate-600">
        {t('genderHint')}
      </span>
      {props.error === undefined ? null : (
        <span id={`${id}-error`} className="text-sm font-medium text-red-700">
          {t('fieldErrors.gender.required')}
        </span>
      )}
    </fieldset>
  );
}
