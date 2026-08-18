import React from 'react';
import { Drawer } from 'expo-router/drawer';
import { useTranslation } from 'react-i18next';
import { typography } from '@kiksu/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { DrawerContent } from '@/components/DrawerContent';
import { HeaderIcon } from '@/components/HeaderIcon';

/**
 * The six-destination drawer from docs/03-navigation.md. Order, Azerbaijani
 * labels and route segments match the spec table exactly.
 *
 * Gesture: edge-swipe-to-open is on by default and turned off only for
 * `timetable`, whose week grid scrolls horizontally and would otherwise
 * fight the drawer's own edge gesture (spec: "Gesture" section).
 */
export default function DrawerLayout() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerShadowVisible: true,
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: theme.text(typography.heading.sm),
        headerTitleAlign: 'center',
        sceneStyle: { backgroundColor: theme.colors.background },
        drawerStyle: { backgroundColor: theme.colors.surface, width: 300 },
        drawerActiveTintColor: theme.colors.primary,
        drawerActiveBackgroundColor: theme.colors.primaryLight,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerLabelStyle: theme.text(typography.bodyMedium.base),
        overlayStyle: { backgroundColor: 'rgba(20,28,36,0.4)' },
      }}
    >
      <Drawer.Screen
        name="today"
        options={{
          title: t('nav.today'),
          drawerLabel: t('nav.today'),
          headerRight: () => <HeaderIcon name="bell" accessibilityLabel={t('header.notifications')} />,
        }}
      />
      <Drawer.Screen
        name="timetable"
        options={{
          title: t('nav.timetable'),
          drawerLabel: t('nav.timetable'),
          // The week grid scrolls horizontally — disable the conflicting edge-swipe here only.
          swipeEnabled: false,
        }}
      />
      <Drawer.Screen
        name="forum"
        options={{
          title: t('nav.forum'),
          drawerLabel: t('nav.forum'),
          headerRight: () => <HeaderIcon name="search" accessibilityLabel={t('header.search')} />,
        }}
      />
      <Drawer.Screen
        name="market"
        options={{
          title: t('nav.market'),
          drawerLabel: t('nav.market'),
          headerRight: () => <HeaderIcon name="search" accessibilityLabel={t('header.search')} />,
        }}
      />
      <Drawer.Screen
        name="careers"
        options={{
          title: t('nav.careers'),
          drawerLabel: t('nav.careers'),
          headerRight: () => <HeaderIcon name="filter" accessibilityLabel={t('header.filter')} />,
        }}
      />
      <Drawer.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          drawerLabel: t('nav.profile'),
        }}
      />
      {/*
        Reviews are a route group, not a destination. The product plan is
        explicit that they do not get one: a lookup tool used hard for two
        weeks at course registration and barely otherwise belongs where the
        student is already picking courses, which is the class detail sheet.

        This entry exists ONLY to hide it. Expo Router derives drawer items
        from the filesystem, so without it `reviews` would appear as a seventh
        item labelled "reviews" — and the six destinations in
        docs/03-navigation.md are a settled decision, not a default.
      */}
      <Drawer.Screen
        name="reviews"
        options={{ drawerItemStyle: { display: 'none' }, headerShown: false }}
      />
    </Drawer>
  );
}
