import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function MarketScreen() {
  const { t } = useTranslation();
  return <ScreenPlaceholder title={t('screens.market.title')} description={t('screens.market.description')} />;
}
