import { Redirect } from 'expo-router';

/**
 * "Bu gün" is the landing route after auth per docs/03-navigation.md.
 *
 * Unconditional on purpose: an unverified caller never reaches this component,
 * because RootNavigator in _layout.tsx redirects to onboarding before rendering
 * the slot this route lives in.
 */
export default function Index() {
  return <Redirect href="/today" />;
}
