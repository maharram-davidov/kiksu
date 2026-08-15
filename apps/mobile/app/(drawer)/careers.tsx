import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function CareersScreen() {
  const { t } = useTranslation();
  return <ScreenPlaceholder title={t('screens.careers.title')} description={t('screens.careers.description')} />;
}
