import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function TodayScreen() {
  const { t } = useTranslation();
  return <ScreenPlaceholder title={t('screens.today.title')} description={t('screens.today.description')} />;
}
