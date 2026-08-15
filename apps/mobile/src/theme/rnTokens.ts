/**
 * Converts the raw, CSS-flavoured design tokens in `@kiksu/tokens` (px strings,
 * em letter-spacing, CSS font stacks) into values React Native's StyleSheet API
 * actually accepts (numbers, platform font families).
 *
 * Nothing in here invents new design values — it only changes units. Colour,
 * scale and ratio all still come from `packages/tokens/tokens.ts`.
 */
import { Platform, type TextStyle } from 'react-native';
import { radii, spacing, typography } from '@kiksu/tokens';

/** '10px' -> 10. Returns undefined for composite/non-numeric values (unused here). */
function parsePx(value: string): number | undefined {
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  return match ? parseFloat(match[1]) : undefined;
}

/** '.06em' -> a multiplier (0.06). */
function parseEm(value: string): number {
  const match = /^(-?[\d.]+)em$/.exec(value.trim());
  return match ? parseFloat(match[1]) : 0;
}

/** Numeric spacing scale, e.g. spacingPx['6'] === 16. */
export const spacingPx: Record<keyof typeof spacing, number> = Object.fromEntries(
  Object.entries(spacing).map(([key, value]) => [key, parsePx(value) ?? 0])
) as Record<keyof typeof spacing, number>;

/**
 * Numeric radii scale. `full` and the composite modal shorthands aren't plain
 * px values, so they're kept as-is for callers that special-case them (see
 * `circleRadius` below) and are typed loosely as `number | string`.
 */
export const radiiPx: Record<keyof typeof radii, number | string> = Object.fromEntries(
  Object.entries(radii).map(([key, value]) => {
    const parsed = parsePx(value);
    return [key, parsed ?? value];
  })
) as Record<keyof typeof radii, number | string>;

/** True circles (avatars, dots) aren't `borderRadius: '50%'` in React Native — halve the box instead. */
export function circleRadius(size: number): number {
  return size / 2;
}

/**
 * The design's CSS font stacks ('-apple-system, SF Pro Text, ...') don't mean
 * anything to React Native, which can only address one named family at a
 * time. We map each stack to the closest platform-native equivalent:
 *  - sans -> the OS default (undefined selects the system font: San
 *    Francisco on iOS, Roboto on Android). Both ship full Azerbaijani
 *    Latin coverage (ə ğ ı ö ş ü ç) because az is a supported system
 *    locale on both platforms.
 *  - mono -> the OS default monospace (Menlo on iOS, Roboto Mono via the
 *    'monospace' generic on Android). The design itself sets its eyebrow/
 *    label text — including phrases containing ə, e.g. "FORUM LƏQƏBİ" — in
 *    this stack, so we match it rather than special-case those strings into
 *    sans. If a target monospace face is ever missing a glyph, both
 *    platforms fall back to a system font that has it (Android in
 *    particular does this via its font-fallback chain), so the character
 *    still renders — just not perfectly monospaced for that one glyph. This
 *    is the one Azerbaijani glyph worth eyeballing on a real device; see
 *    README "Font stack notes".
 */
export const fontFamilies = {
  sans: Platform.select({ ios: undefined, android: undefined, default: undefined }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export type FontFamilyKey = keyof typeof fontFamilies;

interface RNTextStyle {
  fontFamily: string | undefined;
  fontSize: number;
  fontWeight: TextStyle['fontWeight'];
  letterSpacing?: number;
}

/**
 * Resolves one entry from `typography` (e.g. `typography.heading.lg`) into a
 * ready-to-spread React Native text style. Handles the px and em -> number
 * conversions in one place so screens never touch raw token strings.
 */
export function textStyle(scale: {
  fontSize: string;
  fontWeight: number;
  fontFamily: keyof typeof typography.fontFamilies;
  letterSpacing?: string;
}): RNTextStyle {
  const fontSize = parsePx(scale.fontSize) ?? 14;
  return {
    fontFamily: fontFamilies[scale.fontFamily],
    fontSize,
    fontWeight: String(scale.fontWeight) as TextStyle['fontWeight'],
    ...(scale.letterSpacing ? { letterSpacing: parseEm(scale.letterSpacing) * fontSize } : {}),
  };
}
