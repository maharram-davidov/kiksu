import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function ProfileScreen() {
  const { t } = useTranslation();
  return <ScreenPlaceholder title={t('screens.profile.title')} description={t('screens.profile.description')} />;
}
