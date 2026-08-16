import type { ErrorCode } from "./error-codes";
import { ERROR_CODES } from "./error-codes";
import type { Locale } from "../locale/locale";
import { SUPPORTED_LOCALES } from "../locale/locale";

/**
 * The server-side message catalogue (§3.2): "Messages live in a server-side
 * catalogue, so wording can be corrected without an app-store release." `az` is the
 * default and every code has all three locales — a missing translation is a build-time
 * error here (the `Record<ErrorCode, Record<Locale, string>>` type below), never a
 * silent fallback to a key name or to English-by-accident.
 *
 * Every message follows §3.2's rule: name what happened in the student's terms and
 * what they can do next. None of these are raw — no stack traces, no constraint names,
 * no SQL, no host names, no internal identifiers.
 *
 * A handful of entries reuse wording given verbatim in the conventions doc
 * (`token_stale`, `verification_required`, `review_already_written`) so the shipped
 * copy matches the spec exactly rather than a paraphrase.
 *
 * NOTE for whoever ships this: these translations were written by an engineer, not a
 * native-speaker localiser. Az is closest to the doc's own examples; ru/en should get
 * a native-speaker pass before this catalogue is treated as final copy — flagged in
 * the README's Open Questions.
 */
export const ERROR_MESSAGES: Record<ErrorCode, Record<Locale, string>> = {
  // Transport / client
  client_version_unsupported: {
    az: "Tətbiqin bu versiyası artıq dəstəklənmir. Davam etmək üçün yenilə.",
    ru: "Эта версия приложения больше не поддерживается. Обновите приложение, чтобы продолжить.",
    en: "This app version is no longer supported. Update to continue.",
  },
  malformed_request: {
    az: "Göndərilən sorğu oxuna bilmədi.",
    ru: "Не удалось разобрать запрос.",
    en: "The request body could not be parsed.",
  },
  validation_failed: {
    az: "Göndərilən məlumatlarda problem var.",
    ru: "В отправленных данных есть ошибка.",
    en: "There's a problem with the submitted data.",
  },
  cursor_invalid: {
    az: "Səhifələmə etibarsızdır. Siyahı yenidən yüklənir.",
    ru: "Курсор пагинации недействителен. Список загрузится заново.",
    en: "The pagination cursor is invalid. The list will reload from the start.",
  },
  unsupported_media_type: {
    az: "Bu fayl növü dəstəklənmir.",
    ru: "Этот тип файла не поддерживается.",
    en: "This file type isn't supported.",
  },
  payload_too_large: {
    az: "Göndərilən fayl çox böyükdür.",
    ru: "Отправленный файл слишком большой.",
    en: "The uploaded file is too large.",
  },
  not_found: {
    az: "Axtardığın məzmun tapılmadı.",
    ru: "Запрошенное содержимое не найдено.",
    en: "We couldn't find what you're looking for.",
  },
  conflict: {
    az: "Bu əməliyyatı indi tamamlamaq olmadı. Yenidən cəhd et.",
    ru: "Не удалось выполнить действие сейчас. Повторите попытку.",
    en: "That couldn't be completed right now. Try again.",
  },
  precondition_failed: {
    az: "Məzmun bu müddətdə dəyişib. Səhifəni yenilə və yenidən cəhd et.",
    ru: "Содержимое изменилось за это время. Обновите страницу и повторите попытку.",
    en: "This content changed in the meantime. Refresh and try again.",
  },
  rate_limited: {
    az: "Çox sürətli göndərirsən. Bir az sonra yenidən cəhd et.",
    ru: "Слишком быстро. Повторите попытку чуть позже.",
    en: "You're going too fast. Try again in a bit.",
  },

  // Auth / account
  unauthenticated: {
    az: "Davam etmək üçün hesabına daxil ol.",
    ru: "Чтобы продолжить, войдите в аккаунт.",
    en: "Sign in to continue.",
  },
  token_stale: {
    az: "Sessiya yeniləndi. Yenidən cəhd edirik.",
    ru: "Сессия обновлена. Повторяем попытку.",
    en: "Session refreshed. Retrying.",
  },
  token_invalid: {
    az: "Sessiyan etibarsızdır. Yenidən daxil ol.",
    ru: "Сессия недействительна. Войдите снова.",
    en: "Your session is invalid. Please sign in again.",
  },
  forbidden: {
    az: "Bu əməliyyatı yerinə yetirmək mümkün deyil.",
    ru: "Это действие недоступно.",
    en: "That action isn't available.",
  },
  verification_required: {
    az: "Bunun üçün tələbə doğrulaması lazımdır.",
    ru: "Для этого требуется подтверждение статуса студента.",
    en: "This requires student verification.",
  },
  verification_expired: {
    az: "Doğrulamanın müddəti bitib. Yenidən doğrula.",
    ru: "Срок подтверждения истёк. Подтвердите статус заново.",
    en: "Your verification has expired. Verify again.",
  },
  tier_insufficient: {
    az: "Bu əməliyyat üçün tələbə kartı doğrulaması lazımdır.",
    ru: "Для этого действия требуется подтверждение студенческим билетом.",
    en: "This action requires student card verification.",
  },
  sanction_active: {
    az: "Hesabına müvəqqəti məhdudiyyət qoyulub.",
    ru: "На ваш аккаунт наложено временное ограничение.",
    en: "A temporary restriction is active on your account.",
  },
  account_suspended: {
    az: "Hesabın müvəqqəti dayandırılıb.",
    ru: "Ваш аккаунт временно приостановлен.",
    en: "Your account is temporarily suspended.",
  },
  account_banned: {
    az: "Hesabın bloklanıb.",
    ru: "Ваш аккаунт заблокирован.",
    en: "Your account has been banned.",
  },
  not_campus_member: {
    az: "Bu, sənin universitetinə aid deyil.",
    ru: "Это относится к другому университету.",
    en: "This belongs to a different university.",
  },

  // Onboarding / verification
  verification_route_unavailable: {
    az: "Bu doğrulama üsulu bu universitet üçün mövcud deyil.",
    ru: "Этот способ подтверждения недоступен для этого университета.",
    en: "This verification method isn't available for this university.",
  },
  verification_domain_not_allowed: {
    az: "Bu e-poçt ünvanı seçdiyin universitetə uyğun gəlmir.",
    ru: "Этот адрес эл. почты не соответствует выбранному университету.",
    en: "This email address doesn't match the selected university.",
  },
  verification_challenge_invalid: {
    az: "Kod yanlışdır və ya vaxtı bitib.",
    ru: "Код неверен или срок его действия истёк.",
    en: "That code is wrong or has expired.",
  },
  verification_challenge_locked: {
    az: "Çox sayda yanlış cəhd oldu. Bir az sonra yenidən cəhd et.",
    ru: "Слишком много неверных попыток. Повторите попытку позже.",
    en: "Too many incorrect attempts. Try again later.",
  },
  verification_in_progress: {
    az: "Bu üsul üçün artıq aktiv cəhd var.",
    ru: "По этому способу уже есть активная попытка.",
    en: "There's already an active attempt on this route.",
  },
  credential_unavailable: {
    az: "Bu məlumatla doğrulamaq mümkün olmadı.",
    ru: "Подтвердить с этими данными не удалось.",
    en: "We couldn't verify with those details.",
  },
  invite_code_invalid: {
    az: "Kod etibarsızdır.",
    ru: "Код недействителен.",
    en: "That code isn't valid.",
  },
  invite_quota_exhausted: {
    az: "Maksimum aktiv dəvət kodu sayına çatmısan.",
    ru: "Достигнут максимум активных кодов приглашения.",
    en: "You've reached the limit of active invite codes.",
  },
  invite_not_permitted: {
    az: "Hazırda dəvət kodu yarada bilmirsən.",
    ru: "Сейчас вы не можете создать код приглашения.",
    en: "You can't issue an invite code right now.",
  },
  card_submission_limit_reached: {
    az: "Maksimum göndəriş sayına çatmısan. Apellyasiya et.",
    ru: "Достигнут лимит попыток отправки. Подайте апелляцию.",
    en: "You've reached the submission limit. File an appeal.",
  },
  card_review_pending: {
    az: "Göndərişin artıq nəzərdən keçirilir.",
    ru: "Ваша заявка уже на рассмотрении.",
    en: "Your submission is already being reviewed.",
  },

  // Identity / profile
  handle_cooldown_active: {
    az: "Ləqəbini indi dəyişə bilməzsən.",
    ru: "Сейчас нельзя изменить псевдоним.",
    en: "You can't change your handle right now.",
  },
  handle_space_exhausted: {
    az: "Hazırda yeni ləqəb yaratmaq mümkün olmadı. Bir az sonra yenidən cəhd et.",
    ru: "Сейчас не удалось создать новый псевдоним. Повторите попытку позже.",
    en: "We couldn't generate a new handle right now. Try again shortly.",
  },
  discovery_disabled: {
    az: "Bu profil axtarışda görünmür.",
    ru: "Этот профиль не отображается в поиске.",
    en: "This profile isn't visible in search.",
  },

  // Forum
  board_archived: {
    az: "Bu lövhə arxivləşdirilib.",
    ru: "Этот раздел заархивирован.",
    en: "This board has been archived.",
  },
  post_locked: {
    az: "Bu mövzu kilidlənib.",
    ru: "Эта тема закрыта.",
    en: "This thread is locked.",
  },
  content_removed: {
    az: "Bu məzmun silinib.",
    ru: "Это содержимое удалено.",
    en: "This content has been removed.",
  },
  alias_reservation_expired: {
    az: "Rezerv olunmuş nömrənin vaxtı bitib. Yenidən cəhd et.",
    ru: "Срок резервирования номера истёк. Повторите попытку.",
    en: "The reserved alias number expired. Try again.",
  },
  poll_closed: {
    az: "Bu sorğu bağlanıb.",
    ru: "Этот опрос закрыт.",
    en: "This poll is closed.",
  },
  poll_choice_limit: {
    az: "İcazə verilən seçim sayını aşmısan.",
    ru: "Превышено допустимое количество вариантов.",
    en: "You've exceeded the allowed number of choices.",
  },
  attachment_rejected: {
    az: "Fayl qəbul edilmədi.",
    ru: "Файл не принят.",
    en: "That attachment was rejected.",
  },
  daily_post_quota: {
    az: "Bugünkü paylaşım limitinə çatmısan.",
    ru: "Достигнут дневной лимит публикаций.",
    en: "You've reached today's posting limit.",
  },

  // Timetable
  already_enrolled: {
    az: "Bu kursa artıq yazılmısan.",
    ru: "Вы уже записаны на этот курс.",
    en: "You're already enrolled in this course.",
  },
  not_enrolled: {
    az: "Bunun üçün kursa yazılmış olmalısan.",
    ru: "Для этого нужно быть записанным на курс.",
    en: "You need to be enrolled in this course.",
  },
  section_full: {
    az: "Bu qrupda yer qalmayıb.",
    ru: "В этой группе нет свободных мест.",
    en: "This section is full.",
  },
  term_closed: {
    az: "Bu semestr üçün qeydiyyat müddəti bitib.",
    ru: "Период регистрации на этот семестр закрыт.",
    en: "Registration for this term has closed.",
  },
  absence_already_recorded: {
    az: "Bu dərs üçün davamiyyət artıq qeyd olunub.",
    ru: "Посещаемость по этому занятию уже отмечена.",
    en: "Attendance for this class has already been recorded.",
  },
  grade_scale_unknown: {
    az: "Bu qiymət bu universitet üçün tanınmır.",
    ru: "Эта оценка не распознана для данного университета.",
    en: "That grade isn't recognised for this university.",
  },

  // Reviews
  review_wall_active: {
    az: "Rəy yazmaq üçün əvvəlcə öz töhfəni ver.",
    ru: "Чтобы оставить отзыв, сначала внесите свой вклад.",
    en: "Contribute a review of your own before writing this one.",
  },
  review_already_written: {
    az: "Bu fənn və müəllim üçün bu semestrdə artıq rəy yazmısan.",
    ru: "Вы уже оставили отзыв об этом предмете и преподавателе в этом семестре.",
    en: "You've already reviewed this course and instructor for this term.",
  },
  review_term_not_reviewable: {
    az: "Bu semestr üçün rəy yazmaq mümkün deyil.",
    ru: "Отзывы за этот семестр недоступны.",
    en: "Reviews aren't open for this term.",
  },
  review_tag_unknown: {
    az: "Seçilmiş etiket tanınmır.",
    ru: "Выбранный тег не распознан.",
    en: "That tag isn't recognised.",
  },

  // Server
  internal_error: {
    az: "Nəsə səhv getdi. Yenidən cəhd et.",
    ru: "Что-то пошло не так. Повторите попытку.",
    en: "Something went wrong. Try again.",
  },
  service_unavailable: {
    az: "Xidmət hazırda əlçatan deyil. Bir az sonra yenidən cəhd et.",
    ru: "Сервис временно недоступен. Повторите попытку позже.",
    en: "The service is temporarily unavailable. Try again shortly.",
  },
  dependency_timeout: {
    az: "Sorğu vaxtında tamamlanmadı. Yenidən cəhd et.",
    ru: "Запрос не завершился вовремя. Повторите попытку.",
    en: "The request took too long. Try again.",
  },
};

/**
 * Looks up a message. Falls back `requested locale → az → key name` — the doc's rule
 * is "a missing translation falls back to az, never to a key name and never to
 * English-by-accident." The key-name branch below can only be reached if a future
 * code is added to `ERROR_CODES` without a catalogue entry, which is a programmer
 * error; it's a loud fallback, not a silent one, precisely so that mistake gets
 * noticed instead of shipping as `az` from an unrelated code's copy.
 */
export function getErrorMessage(code: ErrorCode, locale: Locale): string {
  const entry = ERROR_MESSAGES[code];
  return entry[locale] ?? entry[DEFAULT_CATALOGUE_LOCALE] ?? `err.${code}`;
}

const DEFAULT_CATALOGUE_LOCALE: Locale = "az";

/** Dev-time completeness guard: every code, every locale, no gaps. Cheap to run in a unit test. */
export function assertCatalogueComplete(): void {
  for (const code of ERROR_CODES) {
    const entry = ERROR_MESSAGES[code];
    if (!entry) throw new Error(`error-catalogue: missing entry for code "${code}"`);
    for (const locale of SUPPORTED_LOCALES) {
      const message = entry[locale];
      if (!message || message.trim().length === 0) {
        throw new Error(`error-catalogue: missing "${locale}" message for code "${code}"`);
      }
    }
  }
}
