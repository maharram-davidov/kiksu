# @kiksu/mobile

The Kiksu navigation shell: drawer navigation, light/dark theming from
`@kiksu/tokens`, and i18n scaffolding. **No backend, no auth, no API client**
— every screen body is a styled placeholder. See
`/Users/macbook/kiksu/docs/03-navigation.md` for the spec this implements.

Built with Expo SDK 54, Expo Router, TypeScript (strict), and
`@react-navigation/drawer`.

## Run it on your phone

From the repo root:

```sh
npm install
npm run mobile
```

(`npm run mobile` runs `expo start` inside this workspace.) That prints a QR
code and a `Metro waiting on exp://<your-ip>:8081` line. Then:

1. Install **Expo Go** from the App Store (iOS) or Play Store (Android).
2. Make sure your phone is on the **same Wi-Fi network** as this computer.
3. **iOS**: open the Camera app and point it at the QR code, then tap the
   notification. **Android**: open Expo Go and use its built-in QR scanner.

If your network blocks LAN discovery (e.g. campus Wi-Fi with client
isolation), run `npx expo start --tunnel` instead from `apps/mobile` — it
routes through ngrok so the QR code works over any network, just slower to
connect.

## Project layout

```
app/
  _layout.tsx          root providers: gesture handler, safe area, theme, status bar
  index.tsx             redirects "/" -> "/today" (landing route, no auth in this scaffold)
  (drawer)/
    _layout.tsx          the Drawer navigator: 6 screens, custom header, per-screen options
    today.tsx, timetable.tsx, forum.tsx, market.tsx, careers.tsx, profile.tsx
src/
  theme/
    colors.ts             light palette (= tokens) + hand-derived dark palette, both well-commented
    rnTokens.ts            converts tokens.ts's CSS-flavoured values (px, em, font stacks) into RN units
    ThemeProvider.tsx     React context; follows the device's light/dark setting
  i18n/
    index.ts               i18next init, default language 'az'
    locales/az.json         authoritative strings (real Azerbaijani copy)
    locales/ru.json, en.json  stubs, see below
  components/            Avatar, VerificationBadge, DrawerContent, HeaderIcon, ScreenPlaceholder
  lib/mockIdentity.ts    placeholder pseudonymous identity shown in the drawer header
```

`packages/tokens` is now a real npm workspace package (`@kiksu/tokens`) so it
can be imported as `import { colors } from '@kiksu/tokens'` — it previously
had no `package.json`. `tokens.ts` itself was **not modified**.

## Verifying the setup yourself

```sh
npm install                                    # from repo root
cd apps/mobile && npx tsc --noEmit             # zero errors
npx expo start                                 # boots, prints a QR, Ctrl+C to stop
```

## Theming

Every colour in the app comes from `useTheme().colors.*` — nothing hardcodes
a hex value outside `src/theme/colors.ts`. Light values are the design tokens
verbatim; dark values are derived by hand in that one file, with a comment on
each line explaining the transform (invert, brighten-for-contrast, or reuse
an existing token). The design file itself is light-mode only, so the dark
palette has no source of truth to check against — see Open Questions.

## Font stack notes (Azerbaijani rendering)

- **Sans** (body/headings) uses the OS default (San Francisco / Roboto). Both
  ship full Azerbaijani coverage — `ə ğ ı ö ş ü ç` all render correctly —
  because Azerbaijani is a supported system locale on iOS and Android.
- **Mono** (labels, badges, the eyebrow-style caption under the handle) uses
  Menlo / the Android `monospace` generic, matching the design's own choice.
  This includes the drawer's "FORUM LƏQƏBİ · 14 GÜNDƏN BİR DƏYİŞİLİR"
  caption, which contains ə. If a monospace face is ever missing a glyph,
  both platforms fall back to a system font that has it, so the character
  still displays — just not perfectly monospaced for that glyph. This is the
  one thing worth eyeballing on an actual device once you scan the QR code:
  open the drawer and confirm `ə ğ ı ö ş ü ç` all look right, in both the
  handle ("sakit-pərvanə-37") and the caption beneath it.

## i18n

`az` is the default and only fully-written language, per the brief. `ru` and
`en` resource files exist with the same key set (so nothing crashes if a
switcher is added later) but are **machine-drafted stubs** — each file has an
`_meta.status` key saying so. There is no in-app language switcher yet; the
app always boots in `az` regardless of device locale. Wiring a switcher
(calling `i18next.changeLanguage`) is natural `/profile` work, out of scope
here.

## Push notifications and the home-screen widget

**Not attempted in this scaffold**, per instructions. Expo Go cannot host
either: remote push requires a config plugin + native entitlements, and a
home-screen widget requires a native extension target. Both need a
**development build** (`npx expo run:ios` / `npx expo run:android`, or EAS
Build) once that work starts — Expo Go stays useful for everything in this
scaffold (navigation, theming, i18n) but stops being enough the moment either
of those lands.

## Open questions

Things the spec or tokens didn't pin down, where a decision was made rather
than guessed silently:

1. **Dark palette has no source of truth.** `design/kiksu-mobile-screens.html`
   and `packages/tokens/tokens.ts` are light-mode only. The dark values in
   `src/theme/colors.ts` are my best-effort derivation (brand hues brightened
   for contrast, ink/background roles inverted), not something a designer
   signed off on. Treat every dark-mode hex in that file as provisional until
   reviewed.

2. **Drawer header location label is mocked, not computed.** The nav spec
   says to show "University + year, subject to the k-anonymity floor" —
   but per `docs/02-identity-spec.md` §5.3, that floor is enforced entirely
   server-side (the client "performs zero counts and zero joins" and just
   renders a pre-generalised string handed to it). Since there's no backend
   in this stage, `src/lib/mockIdentity.ts` hardcodes `"BDU · 2-Cİ KURS"` as
   a stand-in for that server-computed projection. Nothing here should be
   read as a client-side k-anonymity implementation — there isn't one yet.

3. **Which verification tier the drawer header mock shows.** Design screen 10
   shows a user with email verified *and* card pending simultaneously (both
   are legitimate independent states per the identity spec's route machines).
   The nav spec's drawer section describes a single badge ("✓ email-verified
   **or** KART card-verified"), so the mock identity resolves to one tier
   (`email`) rather than trying to represent both at once. `VerificationBadge`
   does support a `card` tier and a badge-less `provisional` tier if a
   different mock state is wanted later.

4. **Whether generated/server data counts as a "translation key" string.**
   Instruction 6 says every user-visible string must come from a translation
   key. I've treated UI chrome (nav labels, badge text, screen titles/
   descriptions) that way, but treated the mock handle (`sakit-pərvanə-37`)
   and the location label (`BDU · 2-Cİ KURS`) as *data*, not copy — a real
   identity service would emit `"2-Cİ KURS"` as an already-inflected,
   pre-rendered string (per the spec), not something the client reassembles
   from a generic "course level" key + number. Flagging this because it's a
   judgment call, not an obvious reading of the rule.

5. **No app icon / splash screen assets.** The design file has no exportable
   app-icon artwork, so `app.json` doesn't set `icon`/`splash`/
   `adaptive-icon` and Expo Go shows its own default placeholder icon. Add
   real assets (and the corresponding `app.json` fields) once they exist.

6. **Bundle identifiers are placeholders.** `az.kiksu.mobile` (iOS bundle id
   and Android package) is invented — nothing in the brief specifies a
   registered domain or App Store / Play Console account. Confirm the real
   identifiers before any development or production build (Expo Go itself
   doesn't need them).

7. **Detail routes aren't scaffolded.** The nav spec's "Deep links" section
   names `/forum/board/[slug]`, `/forum/post/[id]`, `/market/listing/[id]`,
   `/careers/vacancy/[id]`. Scope for this task was the six top-level
   destinations only, so those dynamic routes don't exist yet — add them as
   nested routes under `app/(drawer)/forum/`, etc. when that content lands,
   keeping the group's shared header/gesture config.

8. **Package pin: Expo SDK 54.0.36, not the newest SDK on the registry.**
   At the time of writing, npm's latest `expo` is 57.x. The brief asked for
   "SDK 54+", so I pinned the newest *54.x* patch rather than the newest
   overall SDK, favoring a version whose exact behavior I could verify over
   one released after my knowledge cutoff. Upgrading is a deliberate later
   decision (`npx expo install expo@^57 && npx expo install --fix`), not
   something to do casually — re-verify the react/react-native override
   below still matches whatever SDK you move to.

9. **Root `package.json` gained an `overrides` block** pinning `react` to
   `19.1.0` and `react-native` to `0.81.5` (SDK 54's bundled versions).
   Without it, several packages' open-ended peer ranges caused npm to hoist a
   *different*, newer React copy at the workspace root than the one this app
   depended on — a classic "two copies of React" bug that causes invalid
   hook call errors at runtime. If you add dependencies later and versions
   drift, re-run `npm ls react react-native` from the repo root and confirm
   each shows exactly one deduped version before trusting the app boots
   cleanly.
