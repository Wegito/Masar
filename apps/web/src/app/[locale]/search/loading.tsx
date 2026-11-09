import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { LoadingState } from '../../../components/loading-state';

export default function SearchLoading(): ReactNode {
  const t = useTranslations('results');
  return <LoadingState label={t('loading')} />;
}
