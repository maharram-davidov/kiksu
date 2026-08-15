import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { circleRadius } from '@/theme/rnTokens';
import { typography } from '@kiksu/tokens';

interface AvatarProps {
  /** Short label rendered inside the circle — never a real name (see docs/03-navigation.md). */
  seed: string;
  size?: number;
}

/** The generated-identity avatar circle shown in the drawer header and profile. */
export function Avatar({ seed, size = 44 }: AvatarProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: circleRadius(size),
          backgroundColor: theme.colors.ink,
        },
      ]}
    >
      <Text
        style={[
          theme.text(typography.label.md),
          { color: theme.colors.onInk },
        ]}
        numberOfLines={1}
      >
        {seed}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
