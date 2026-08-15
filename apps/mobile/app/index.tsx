import { Redirect } from 'expo-router';

/** "Bu gün" is the landing route after auth per docs/03-navigation.md. No auth in this scaffold, so we land there directly. */
export default function Index() {
  return <Redirect href="/today" />;
}
