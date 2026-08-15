import React from 'react';
import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

interface HeaderIconProps {
  name: React.ComponentProps<typeof Feather>['name'];
  accessibilityLabel: string;
}

/**
 * A contextual header-right icon (bell on /today, search on /forum + /market,
 * filter on /careers — per docs/03-navigation.md "Screen header" section).
 * Inert for now: wiring these up to real actions is backend/feature work
 * outside this scaffold's scope.
 */
export function HeaderIcon({ name, accessibilityLabel }: HeaderIconProps) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: 16 }} accessibilityLabel={accessibilityLabel} accessible>
      <Feather name={name} size={20} color={theme.colors.textPrimary} />
    </View>
  );
}
