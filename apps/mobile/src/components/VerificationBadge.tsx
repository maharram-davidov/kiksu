import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { typography } from '@kiksu/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { circleRadius } from '@/theme/rnTokens';
import type { VerificationTier } from '@/lib/mockIdentity';

/**
 * Reproduces the badge styling from design screen 10 (profile): a small
 * teal check-pill for email verification, a bronze pill for the card tier.
 * `provisional` renders nothing — per the identity spec, the provisional
 * (invite) tier carries no badge at all.
 */
export function VerificationBadge({ tier }: { tier: VerificationTier }) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (tier === 'provisional') return null;

  const isCard = tier === 'card';
  const backgroundColor = isCard ? theme.colors.secondaryLight : theme.colors.primaryLight;
  const borderColor = isCard ? theme.colors.borderStrong : theme.colors.primaryAccent;
  const textColor = isCard ? theme.colors.secondaryDark : theme.colors.primaryHover;
  const label = isCard ? t('identity.cardVerifiedBadge') : t('identity.emailVerifiedBadge');

  return (
    <View style={[styles.pill, { backgroundColor, borderColor }]}>
      {!isCard ? (
        <View style={[styles.dot, { backgroundColor: theme.colors.primary }]}>
          <Text style={[theme.text(typography.label.xs), { color: theme.colors.onPrimary }]}>
            {t('identity.verifiedShort')}
          </Text>
        </View>
      ) : null}
      <Text style={[theme.text(typography.label.base), { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: circleRadius(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
