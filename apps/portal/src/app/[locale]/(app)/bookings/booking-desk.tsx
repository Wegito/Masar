'use client';

import { normalizeBookingCode } from '@masar/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { api, formText, type Problem } from '../../../../lib/api';
import type { StaffBooking } from '../../../../lib/booking';
import { BookingPanel } from './booking-panel';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/**
 * Suche nach dem vollständigen Buchungscode und Aktionen am Schalter. Der Code geht nur im
 * POST-Body an die API, nie in die URL (ADR 0016). Die Firma steht im Pfad der API; dass die Person
 * dort Admin oder Agent ist, prüft die API selbst. Personendaten der Buchung bleiben im Speicher
 * der Seite.
 */
export function BookingDesk({ companyId }: { companyId: string }): ReactNode {
  const t = useTranslations('bookings');
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<StaffBooking>();
  const [failure, setFailure] = useState<Failure>();

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const raw = formText(new FormData(event.currentTarget), 'bookingCode');
    setBooking(undefined);
    // Offensichtlich falsche Eingaben gar nicht erst senden; dieselbe Meldung wie die API.
    if (normalizeBookingCode(raw) === null) {
      setFailure({
        problem: {
          code: 'VALIDATION_FAILED',
          status: 400,
          errors: [{ path: 'bookingCode', rule: 'custom' }],
        },
      });
      return;
    }
    setBusy(true);
    const result = await api<StaffBooking>(`/companies/${companyId}/bookings/lookup`, {
      method: 'POST',
      body: { bookingCode: raw },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      setBooking(result.data);
    } else {
      setFailure(result);
    }
  }

  return (
    <section aria-labelledby="desk-heading" className="flex flex-col gap-4">
      <h2 id="desk-heading" className="sr-only">
        {t('search')}
      </h2>
      <form
        onSubmit={(event) => void search(event)}
        className="flex flex-col gap-4 rounded-md border border-brand-100 bg-white p-4 sm:flex-row sm:items-end"
      >
        <div className="sm:w-72">
          <Field
            label={t('code')}
            hint={t('codeHint')}
            name="bookingCode"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            required
          />
        </div>
        <SubmitButton busy={busy}>{busy ? t('searching') : t('search')}</SubmitButton>
      </form>
      {failure ? <ProblemMessage {...failure} /> : null}
      {booking ? (
        // Neuer Schlüssel je Treffer: Ein neuer Treffer beginnt ohne angezeigten Kontakt.
        <BookingPanel key={booking.id} companyId={companyId} initial={booking} />
      ) : null}
    </section>
  );
}
