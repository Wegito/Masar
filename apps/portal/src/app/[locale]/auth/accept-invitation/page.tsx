'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

import { AuthCard } from '../../../../components/auth-card';
import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { Link, useRouter } from '../../../../i18n/navigation';
import { api, formText, type Problem, type UserSummary } from '../../../../lib/api';
import { useHashToken } from '../../../../lib/use-hash-token';

/**
 * Einladung annehmen. Angemeldet: nur bestätigen. Nicht angemeldet: neues Konto mit Name und
 * Passwort. Gibt es die Adresse schon, verlangt die API eine Anmeldung (ADR 0009).
 */
export default function AcceptInvitationPage(): ReactNode {
  const t = useTranslations('accept');
  const router = useRouter();
  const token = useHashToken();
  const [me, setMe] = useState<UserSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Problem>();

  useEffect(() => {
    void api<{ user: UserSummary }>('/auth/me').then((result) =>
      setMe(result.ok ? result.data.user : null),
    );
  }, []);

  async function accept(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    const result = await api('/invitations/accept', { method: 'POST', body: { token, ...body } });
    setBusy(false);
    if (result.ok) {
      router.replace('/');
    } else {
      setFailure(result.problem);
    }
  }

  function submitNewAccount(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void accept({
      displayName: formText(form, 'displayName'),
      password: formText(form, 'password'),
    });
  }

  if (token === null) {
    return (
      <AuthCard title={t('title')}>
        <p role="alert">{t('missingToken')}</p>
      </AuthCard>
    );
  }
  if (me === undefined) {
    return (
      <AuthCard title={t('title')}>
        <p>{t('loading')}</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('title')}>
      {me ? (
        <div className="flex flex-col gap-4">
          <p>{t('signedInAs', { email: me.email ?? '' })}</p>
          {failure ? <ProblemMessage problem={failure} /> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void accept({})}
            className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {t('acceptExisting')}
          </button>
        </div>
      ) : (
        <form onSubmit={submitNewAccount} className="flex flex-col gap-4">
          <p className="text-slate-600">{t('intro')}</p>
          <Field
            label={t('displayName')}
            name="displayName"
            autoComplete="name"
            maxLength={100}
            required
          />
          <Field
            label={t('password')}
            hint={t('hint')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            dir="ltr"
            required
          />
          {failure?.code === 'UNAUTHENTICATED' ? (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {t('existingAccount')}{' '}
              <Link href="/auth/login" className="underline">
                {t('toLogin')}
              </Link>
            </p>
          ) : failure ? (
            <ProblemMessage problem={failure} />
          ) : null}
          <SubmitButton busy={busy}>{t('submit')}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
