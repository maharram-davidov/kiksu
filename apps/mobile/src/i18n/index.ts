import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import az from './locales/az.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const defaultLanguage = 'az';
export const supportedLanguages = ['az', 'ru', 'en'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const resources = { az: { translation: az }, ru: { translation: ru }, en: { translation: en } };

/**
 * Kiksu defaults to Azerbaijani regardless of device locale (per
 * docs/00-project-brief.md: "Default language Azerbaijani (az)... Russian
 * and English as first-class alternates"). ru/en are wired up and ready but
 * there is no in-app language switcher yet — see README "Open questions".
 * When one is built (likely a `/profile` setting), it should call
 * `i18next.changeLanguage(lang)`.
 */
void i18next.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: defaultLanguage,
  interpolation: { escapeValue: false }, // not rendering into HTML, RN text is already safe
  returnNull: false,
});

export default i18next;
