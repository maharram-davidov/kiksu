import type { ErrorAction } from "./error-codes";
import type { Locale } from "../locale/locale";

/**
 * Localised label for each `action` affordance (§3.1's `action_label`). Shared across
 * every error code that uses a given action — "Yenidən cəhd et" means the same thing
 * whether it followed a `conflict` or a `dependency_timeout`, so it lives here once
 * instead of being copy-pasted into 60 catalogue entries.
 *
 * `none` has no affordance, so its label is `null` in every locale.
 */
export const ACTION_LABELS: Record<ErrorAction, Record<Locale, string | null>> = {
  none: { az: null, ru: null, en: null },
  retry: {
    az: "Yenidən cəhd et",
    ru: "Повторить",
    en: "Retry",
  },
  retry_after: {
    az: "Bir az sonra yenidən cəhd et",
    ru: "Повторите чуть позже",
    en: "Try again shortly",
  },
  sign_in: {
    az: "Daxil ol",
    ru: "Войти",
    en: "Sign in",
  },
  refresh_token: {
    az: "Yenilə",
    ru: "Обновить",
    en: "Refresh",
  },
  verify_email: {
    az: "E-poçtu doğrula",
    ru: "Подтвердить эл. почту",
    en: "Verify email",
  },
  verify_card: {
    az: "Kartı doğrula",
    ru: "Подтвердить карту",
    en: "Verify card",
  },
  upgrade_app: {
    az: "Yenilə",
    ru: "Обновить приложение",
    en: "Update app",
  },
  open_settings: {
    az: "Ayarları aç",
    ru: "Открыть настройки",
    en: "Open settings",
  },
  wait_cooldown: {
    az: "Anladım",
    ru: "Понятно",
    en: "Got it",
  },
  contact_support: {
    az: "Dəstəklə əlaqə",
    ru: "Связаться с поддержкой",
    en: "Contact support",
  },
};
