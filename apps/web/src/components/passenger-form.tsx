'use client';

import type { Gender, Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';

import {
  CONTACT_NAME_FIELD,
  EMAIL_FIELD,
  type FieldError,
  passengerField,
  PHONE_FIELD,
} from '../lib/booking';

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg aria-invalid:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const FOCUS_RING =
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600';

/** Eingaben des Formulars; leben nur im Speicher der Seite, nie in URL oder Browser-Speicher. */
export type Draft = Record<string, string>;

/** Liest die Eingaben des Fahrgasts aus dem Formular (`passengers.*`, `contact.*`, Sprache). */
export function draftFromForm(data: FormData, fallbackLocale: Locale): Draft {
  const draft: Draft = {};
  for (const [name, value] of data.entries()) {
    // Nur Eingaben des Fahrgasts, keine versteckten Felder.
    if (typeof value === 'string' && name.includes('.')) {
      draft[name] = value;
    }
  }
  const chosenLocale = data.get('notificationLocale');
  draft.notificationLocale = typeof chosenLocale === 'string' ? chosenLocale : fallbackLocale;
  return draft;
}

export interface PassengerFormProps {
  /** Server Action `prepareSeats`; ohne JavaScript schickt der Browser das Formular selbst ab. */
  action: (form: FormData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  passengers: number;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  companyName: string;
  draft: Draft;
  fields: Record<string, FieldError>;
  /** Hinweis oben im Formular (Feldfehler oder Problem aus der API); bekommt den Fokus. */
  notice: ReactNode;
  /** Ändert sich mit jeder neuen Fehlerantwort; der Hinweis bekommt dann den Fokus. */
  noticeAt: number | null;
  /** Überschrift fokussieren, etwa beim Zurückkommen vom Sitzplan; nicht beim ersten Laden. */
  focusHeading: boolean;
}

/**
 * Fahrgastdaten vor der Sitzwahl (ADR 0034): je Fahrgast Name, Geschlecht (nur bei Regel, Pflicht,
 * ohne Vorbelegung) und Ausweisnummer (nur bei Pflicht), dazu einmal Kontakt. Ein echtes Formular
 * mit Server Action: Alle Eingaben gehen im POST-Body an den Web-Server, nie in eine URL. Geprüft
 * wird auf dem Server; Hinweise erscheinen in der Sprache der Seite, deshalb `noValidate`. Die
 * Seite erklärt nicht, wofür das Geschlecht dient (Wunsch der Projektleitung).
 */
export function PassengerForm(props: PassengerFormProps): ReactNode {
  const t = useTranslations('booking');
  const locale = useLocale() as Locale;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const { noticeAt, focusHeading } = props;

  useEffect(() => {
    if (noticeAt !== null) {
      noticeRef.current?.focus();
    } else if (focusHeading) {
      headingRef.current?.focus();
    }
  }, [noticeAt, focusHeading]);

  const value = (name: string): string | undefined => props.draft[name];
  const savedGender = (index: number): Gender | undefined => {
    const saved = value(passengerField(index, 'gender'));
    return saved === 'FEMALE' || saved === 'MALE' ? saved : undefined;
  };
  const notificationLocale = value('notificationLocale') ?? locale;
  const fields = props.fields;

  return (
    <section aria-labelledby="details-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-600">{t('stepDetails')}</p>
        <h2
          id="details-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('detailsHeading')}
        </h2>
        <p className="text-slate-700">{t('detailsIntro')}</p>
      </div>

      <div ref={noticeRef} tabIndex={-1} className="focus-visible:outline-none">
        {props.notice}
      </div>

      <form
        action={props.action}
        method="post"
        onSubmit={props.onSubmit}
        noValidate
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="tripId" value={props.tripId} />
        <input type="hidden" name="fromStopId" value={props.fromStopId} />
        <input type="hidden" name="toStopId" value={props.toStopId} />
        <input type="hidden" name="passengerCount" value={String(props.passengers)} />
        <input type="hidden" name="genderRule" value={props.genderRuleEnabled ? '1' : '0'} />
        <input
          type="hidden"
          name="nationalIdRequired"
          value={props.nationalIdRequired ? '1' : '0'}
        />

        {Array.from({ length: props.passengers }, (_, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-4 rounded-lg border border-brand-100 bg-white p-4"
          >
            <legend className="px-1 text-lg font-semibold">
              {t('passengerNumber', { number: String(index + 1) })}
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
                defaultValue={savedGender(index)}
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

        <fieldset className="flex flex-col gap-4 rounded-lg border border-brand-100 bg-white p-4">
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
                    className={`flex min-h-11 cursor-pointer items-center rounded-lg border-2 border-slate-300 bg-white px-4 font-medium peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-900 ${FOCUS_RING}`}
                  >
                    {option === 'ar' ? 'العربية' : 'English'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <button
          type="submit"
          disabled={props.pending}
          className="rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {props.pending ? t('preparingSeats') : t('toSeats')}
        </button>
      </form>
    </section>
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

/**
 * Geschlecht als Pflichtfeld: zwei Optionen, keine vorbelegt, kein „keine Angabe". Der Hinweis
 * sagt nur, dass die Angabe Pflicht ist und nicht auf dem Ticket steht.
 */
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
              className={`flex min-h-11 cursor-pointer items-center rounded-lg border-2 border-slate-300 bg-white px-4 font-medium peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-900 ${FOCUS_RING}`}
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
