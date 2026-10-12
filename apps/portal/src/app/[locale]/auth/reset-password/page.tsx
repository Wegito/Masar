'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { AuthCard } from '../../../../components/auth-card';
import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { Link } from '../../../../i18n/navigation';
import { api, formText, type Problem } from '../../../../lib/api';
import { useHashToken } from '../../../../lib/use-hash-token';

export default function ResetPasswordPage(): ReactNode {
  const t = useTranslations('reset');
  const token = useHashToken();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<Problem>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await api('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, password: formText(form, 'password') },
    });
    setBusy(false);
    if (result.ok) {
      setDone(true);
    } else {
      setFailure(result.problem);
    }
  }

  if (token === null) {
    return (
      <AuthCard title={t('title')}>
        <p role="alert" className="text-slate-700">
          {t('missingToken')}
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('title')}>
      {done ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="rounded-lg bg-brand-50 p-3 text-brand-900">
            {t('done')}
          </p>
          <Link href="/auth/login" className="text-brand-700 underline">
            {t('toLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
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
          {failure ? <ProblemMessage problem={failure} /> : null}
          <SubmitButton busy={busy}>{t('submit')}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
