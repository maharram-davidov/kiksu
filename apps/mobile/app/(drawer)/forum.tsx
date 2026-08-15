import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function ForumScreen() {
  const { t } = useTranslation();
  return <ScreenPlaceholder title={t('screens.forum.title')} description={t('screens.forum.description')} />;
}
