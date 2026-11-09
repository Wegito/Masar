import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { LoadingState } from '../../../../components/loading-state';

export default function TripLoading(): ReactNode {
  const t = useTranslations('trip');
  return <LoadingState label={t('loadingSeats')} cards={1} />;
}
