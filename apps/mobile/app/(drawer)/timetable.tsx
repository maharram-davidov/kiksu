import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function TimetableScreen() {
  const { t } = useTranslation();
  return (
    <ScreenPlaceholder title={t('screens.timetable.title')} description={t('screens.timetable.description')} />
  );
}
