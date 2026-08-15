// Gives `t('some.key')` compile-time checking against the az resource, which is
// the authoritative key set (ru/en are stubs and must contain the same keys).
import 'i18next';
import type az from './locales/az.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof az;
    };
  }
}
