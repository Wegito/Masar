'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { AuthCard } from '../../../../components/auth-card';
import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { Link, useRouter } from '../../../../i18n/navigation';
import { api, formText, type Problem } from '../../../../lib/api';

export default function LoginPage(): ReactNode {
  const t = useTranslations('login');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ problem: Problem; retryAfterSeconds?: number }>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await api('/auth/login', {
      method: 'POST',
      body: { email: formText(form, 'email'), password: formText(form, 'password') },
    });
    setBusy(false);
    if (result.ok) {
      router.replace('/');
    } else {
      setFailure(result);
    }
  }

  return (
    <AuthCard title={t('title')}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field
          label={t('email')}
          name="email"
          type="email"
          autoComplete="username"
          dir="ltr"
          required
        />
        <Field
          label={t('password')}
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
        {failure ? <ProblemMessage {...failure} /> : null}
        <SubmitButton busy={busy}>{t('submit')}</SubmitButton>
      </form>
      <Link href="/auth/forgot-password" className="text-sm text-brand-700 underline">
        {t('forgot')}
      </Link>
    </AuthCard>
  );
}
