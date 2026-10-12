'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { AuthCard } from '../../../../components/auth-card';
import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { api, formText, type Problem } from '../../../../lib/api';

export default function ForgotPasswordPage(): ReactNode {
  const t = useTranslations('forgot');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<Problem>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await api('/auth/password-reset/request', {
      method: 'POST',
      body: { email: formText(form, 'email') },
    });
    setBusy(false);
    if (result.ok) {
      setSent(true);
    } else {
      setFailure(result.problem);
    }
  }

  return (
    <AuthCard title={t('title')}>
      {sent ? (
        // Gleicher Text für bekannte und unbekannte Adressen (keine Auskunft über Konten).
        <p role="status" className="rounded-lg bg-brand-50 p-3 text-brand-900">
          {t('sent')}
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <p className="text-slate-600">{t('intro')}</p>
          <Field
            label={t('email')}
            name="email"
            type="email"
            autoComplete="username"
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
