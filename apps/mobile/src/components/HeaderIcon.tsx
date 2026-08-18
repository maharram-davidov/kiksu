import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

interface HeaderIconProps {
  name: React.ComponentProps<typeof Feather>['name'];
  accessibilityLabel: string;
  /**
   * Omit for the icons that still have nowhere to go. An icon without a
   * handler renders as a plain View rather than a Pressable, so it does not
   * offer a touch target that does nothing — a button that visibly responds
   * and then produces no result reads as a broken app, where an inert glyph
   * reads as a label.
   */
  onPress?: () => void;
}

/**
 * A contextual header-right icon (bell on /today, search on /forum + /market,
 * filter on /careers — per docs/03-navigation.md "Screen header" section).
 *
 * The two search icons are live and push /search. The bell and the filter are
 * still inert: notifications and career filters are not built.
 */
export function HeaderIcon({ name, accessibilityLabel, onPress }: HeaderIconProps) {
  const theme = useTheme();
  const glyph = <Feather name={name} size={20} color={theme.colors.textPrimary} />;

  if (!onPress) {
    return (
      <View style={{ paddingHorizontal: 16 }} accessibilityLabel={accessibilityLabel} accessible>
        {glyph}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => ({ paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}
    >
      {glyph}
    </Pressable>
  );
}
