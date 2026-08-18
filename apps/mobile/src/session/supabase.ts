// Must precede the supabase-js import: its internal URL handling relies on a
// complete URL/URLSearchParams, and React Native's built-in versions are
// partial. Without this, requests are built with silently truncated query
// strings rather than failing outright.
import "react-native-url-polyfill/auto";

import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createChunkedStorage } from "./chunked-storage";

/**
 * Expo inlines `EXPO_PUBLIC_*` into the bundle at build time, so both of these
 * ship inside the app. That is correct for these two and only these two: the
 * project URL is public, and the anon key is a publishable identifier that
 * grants nothing on its own — every table grant this schema hands to `anon` was
 * revoked in migration 0000, and the app is not a PostgREST client.
 *
 * The SERVICE ROLE key must never appear here, in any form, for any reason. It
 * carries BYPASSRLS and can read the sealed `identity` schema directly; a copy
 * in the bundle is a copy on every student's phone. It lives only in the API's
 * environment — see the SECURITY note in apps/api/src/config/env.schema.ts.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether real authentication is available in this build.
 *
 * When false the app falls back to the API's development bypass, which serves
 * every authenticated route as one seeded student. That fallback is what makes
 * `scripts/dev-api.sh` work without Docker: it stands up a throwaway Postgres
 * with no GoTrue at all, so there is nothing to sign in to.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Chunked Keychain/Keystore-backed storage for the Supabase session.
 *
 * WHY NOT AsyncStorage, which is what most React Native examples use: it is
 * plaintext on disk. The refresh token is a long-lived credential for an
 * account whose entire purpose is to stay unlinkable from a real student, so
 * recovering one off a stolen or backed-up phone is a direct path to reading
 * and writing as that pseudonym. Every other layer of this product treats that
 * linkage as the thing worth protecting; storing the key to it in the clear
 * would be the weakest point in the chain by a wide margin.
 *
 * The chunking itself lives in chunked-storage.ts, which imports nothing from
 * React Native so its torn-write behaviour can be tested without a device.
 */
const chunkedSecureStore = createChunkedStorage(SecureStore);

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Null when the build carries no Supabase configuration — see
 * {@link isSupabaseConfigured}. Callers must branch on that rather than
 * asserting this is present.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        storage: chunkedSecureStore,
        // The session must survive a restart. Unlike the previous in-memory
        // holder this is now a real credential at rest, which is why the
        // storage above is Keychain-backed rather than AsyncStorage.
        persistSession: true,
        autoRefreshToken: true,
        // React Native has no URL bar to parse a session out of, and leaving
        // this on makes supabase-js reach for browser APIs during
        // initialisation — the usual cause of a client that hangs on the first
        // call instead of erroring.
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Auto-refresh only ticks while the app is in the foreground.
 *
 * Supabase's refresh timer is a JS interval, and React Native suspends those
 * when the app is backgrounded — so a phone left in a pocket past the 900s
 * access-token TTL wakes up holding an expired token and the first request
 * after resume fails. Restarting the timer on foreground is the documented fix
 * and it also stops the client burning refreshes it cannot use.
 *
 * The API client's 401 retry (see src/api/client.ts) is the second line here:
 * even with this, a request can race the resume.
 */
if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
