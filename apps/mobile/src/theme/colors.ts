/**
 * Semantic colour roles for the app, in both light and dark mode.
 *
 * The LIGHT palette is a direct, 1:1 mapping onto `@kiksu/tokens` — every
 * value here is a token value, never a new hex. The DARK palette does not
 * exist in the design or in `tokens.ts` (the design file is light-mode only),
 * so it is *derived* here, in this one place, with the reasoning for each
 * value written next to it. No other file in the app should ever compute or
 * hardcode a dark-mode colour — they read `theme.colors.*` instead.
 *
 * Derivation approach: each dark value is produced from its light
 * counterpart by one of three moves, noted per line:
 *   - INVERT   role reversal between the two ends of the light/dark scale
 *              (e.g. the near-black "ink" text colour becomes the near-white
 *              text colour in dark mode, and vice versa).
 *   - BRIGHTEN brand hues (teal / bronze / pomegranate) are lifted in
 *              lightness/saturation so they still clear ~4.5:1 contrast
 *              against a dark surface — used flat, they'd look muddy and
 *              under-contrast on a dark background.
 *   - REUSE    an existing token is reused verbatim because it already sits
 *              in the middle of the scale and reads fine on either surface.
 */
import { colors as tokenColors } from '@kiksu/tokens';

export interface ThemeColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceAlt: string;
  // Borders
  border: string;
  borderLight: string;
  borderStrong: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textPlaceholder: string;
  // Brand / primary (Şirvan turkuazı)
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryAccent: string;
  onPrimary: string;
  // Secondary / bronze (Tunc — card verification tier)
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  // Urgent / pomegranate (Nar — deadlines)
  urgent: string;
  urgentLight: string;
  urgentDark: string;
  // High-contrast fill (ink / avatar backgrounds / dark buttons)
  ink: string;
  onInk: string;
}

/** Light theme: verbatim from the extracted design tokens. */
export const lightColors: ThemeColors = {
  background: tokenColors.background, // Bakı əhəngdaşı
  surface: tokenColors.surface,
  surfaceAlt: tokenColors.backgroundLight,

  border: tokenColors.border,
  borderLight: tokenColors.borderLight,
  borderStrong: tokenColors.borderGrayLight, // tan/bronze border used behind the KART badge

  textPrimary: tokenColors.textPrimary,
  textSecondary: tokenColors.textSecondary,
  textMuted: tokenColors.textMuted,
  textPlaceholder: tokenColors.textPlaceholder,

  primary: tokenColors.primary, // Şirvan turkuazı
  primaryHover: tokenColors.primaryHover,
  primaryLight: tokenColors.primaryLight,
  primaryAccent: tokenColors.primaryAccent,
  onPrimary: tokenColors.surface, // white text/icons on a teal fill

  secondary: tokenColors.secondary, // Tunc
  secondaryLight: tokenColors.secondaryLight,
  secondaryDark: tokenColors.secondaryDark,

  urgent: tokenColors.urgent, // Nar
  urgentLight: tokenColors.urgentLight,
  urgentDark: tokenColors.urgentDark,

  ink: tokenColors.ink, // Xəzər mürəkkəbi
  onInk: tokenColors.surface,
};

/**
 * Dark theme: derived from the light tokens above. See the module doc comment
 * for the three derivation moves (INVERT / BRIGHTEN / REUSE) referenced below.
 */
export const darkColors: ThemeColors = {
  // INVERT: the limestone background and near-black ink swap roles —
  // background becomes a near-black, ink becomes the near-white fill.
  background: '#12151A', // darkened, slightly cool version of ink (#141C24) so it isn't pure black
  surface: '#1B2027', // one step up from background, for cards/panels to separate from the page
  surfaceAlt: '#20262E', // a further step up, for nested/alt surfaces (e.g. list rows on a card)

  // INVERT: borders lighten relative to the (now dark) surface instead of darkening.
  border: '#2E3540',
  borderLight: '#252B33',
  borderStrong: '#4A3B1E', // BRIGHTEN of borderGrayLight (#E4D3AC) — dark-bronze tint for the KART badge border

  // INVERT: text goes from near-black-on-light to near-white-on-dark.
  textPrimary: '#F1F0EC', // reuses the light theme's *background* colour (limestone) as dark-mode primary text
  textSecondary: '#B4B9C2', // BRIGHTEN of textSecondary (#4A525C) for AA contrast on #12151A
  textMuted: tokenColors.textMutedLight, // REUSE: #9AA0A8 already sits mid-scale and reads fine on dark
  textPlaceholder: tokenColors.textMuted, // REUSE: #6D7580 — a full step darker than textMuted, correct placeholder relationship

  // BRIGHTEN: brand teal lifted so it still passes ~4.5:1 on a near-black surface.
  primary: '#2FA0AC',
  primaryHover: '#57B7C1', // hover/pressed state is *lighter* than resting in dark mode (opposite of light mode)
  primaryLight: '#132B30', // BRIGHTEN-down: a dark, low-chroma teal tint (was a near-white tint in light mode)
  primaryAccent: '#1F5C66',
  onPrimary: '#0A1113', // near-black text on the brightened teal fill, not white — brightened teal is too light for white-on-top

  // BRIGHTEN: bronze lifted for the same contrast reason as primary.
  secondary: '#D9A94A',
  secondaryLight: '#332711', // dark bronze tint
  secondaryDark: '#F0CE8C', // the *text* colour shown on secondaryLight — needs to be light, not dark, in this mode

  // BRIGHTEN: pomegranate lifted; still reads as "urgent" red against a dark surface.
  urgent: '#D9564A',
  urgentLight: '#331714',
  urgentDark: '#F0B0A8', // text-on-urgentLight equivalent — lightened, mirroring secondaryDark's swap

  // INVERT: ink (near-black fill) becomes a light fill in dark mode so avatar
  // circles / filled buttons still contrast against the dark background.
  ink: '#E8E6E0',
  onInk: '#12151A',
};
