import React from 'react';
import { DrawerContentScrollView, DrawerItemList, type DrawerContentComponentProps } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { typography } from '@kiksu/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { mockIdentity } from '@/lib/mockIdentity';

/**
 * Drawer panel: pseudonymous identity header (handle, avatar, verification
 * badge, k-anon-safe location) followed by the six nav destinations.
 *
 * Per docs/03-navigation.md: no real name, no faculty, ever. Career identity
 * is reachable only from inside /profile, never from here.
 */
export function DrawerContent(props: DrawerContentComponentProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <DrawerContentScrollView
      {...props}
      style={{ backgroundColor: theme.colors.surface }}
      contentContainerStyle={{ paddingTop: 0 }}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: theme.colors.borderLight, backgroundColor: theme.colors.surfaceAlt },
        ]}
      >
        <View style={styles.identityRow}>
          <Avatar seed={mockIdentity.avatarSeed} size={48} />
          <View style={styles.identityText}>
            <Text
              style={[theme.text(typography.heading.sm), { color: theme.colors.textPrimary }]}
              numberOfLines={1}
            >
              {mockIdentity.handle}
            </Text>
            <Text
              style={[theme.text(typography.label.xs), { color: theme.colors.textMuted, marginTop: 3 }]}
              numberOfLines={1}
            >
              {t('identity.handleCaption')}
            </Text>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <VerificationBadge tier={mockIdentity.tier} />
          <View
            style={[
              styles.locationPill,
              { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[theme.text(typography.label.base), { color: theme.colors.textSecondary }]}>
              {mockIdentity.locationLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.items}>
        <DrawerItemList {...props} />
      </View>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    gap: 13,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  locationPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  items: {
    paddingTop: 8,
  },
});
