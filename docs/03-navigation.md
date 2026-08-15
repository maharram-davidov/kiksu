# Navigation spec — drawer

**Status: confirmed.** Supersedes the bottom tab bar shown in the design mockups.

## Why this changed
The design renders a 5-item bottom tab bar on 8 of 10 screens, but the tab set is
inconsistent: the Vacancies screen shows `İŞ` in the 4th slot where every other
screen shows `BAZAR`. Kiksu has six top-level destinations and only five tab slots,
which is what produced that conflict. A drawer removes the slot limit.

**Consequence for screen builders:** the bottom tab bar element in the mockups is
NOT to be implemented. Remove it from every screen. Screen content above it is
unaffected. Reclaim that vertical space for content.

## Library
`@react-navigation/drawer` via Expo Router's `Drawer` layout
(`app/(drawer)/_layout.tsx`). Expo Router is already the confirmed router.

## Destinations
Drawer items, in order. Azerbaijani label is what renders; the route segment is ASCII.

| Order | Label (az) | Route | Notes |
|---|---|---|---|
| 1 | Bu gün | `/today` | Landing route after auth |
| 2 | Cədvəl | `/timetable` | Week grid default; day view toggle |
| 3 | Forum | `/forum` | University boards + national boards |
| 4 | Bazar | `/market` | Listings, housing, lost & found |
| 5 | Karyera | `/careers` | Vacancies, scholarships, events, clubs |
| 6 | Profil | `/profile` | Profile + all settings |

Resolves the `BAZAR` / `İŞ` conflict: both get their own destination.

## Drawer header (top of the drawer panel)
Shows the pseudonymous identity, per the Profile screen design:
- Generated handle (e.g. `sakit-pərvanə-37`)
- Verification tier badge — `✓` email-verified or `KART` card-verified
- University + year, **subject to the k-anonymity floor** in `02-identity-spec.md`.
  Never render faculty here without checking the floor.

Do NOT show real name anywhere in the drawer. Career identity is reachable only
from inside `/profile`, never surfaced at navigation level.

## Screen header (each route)
Left: hamburger (opens drawer). Centre: screen title. Right: contextual —
notifications bell on `/today`, search on `/forum` and `/market`, filter on `/careers`.

## Gesture
Edge-swipe to open, enabled by default. Disable it on `/timetable` — the week grid
is horizontally scrollable and the two gestures fight each other.

## Deep links
Drawer must not swallow deep links. `/forum/board/[slug]`, `/forum/post/[id]`,
`/market/listing/[id]`, `/careers/vacancy/[id]` all open the detail screen with the
correct drawer destination marked active and a working back stack.

## Not in the drawer
Auth and onboarding (`/(auth)/*`) render outside the drawer entirely — no drawer,
no gesture, no header. The drawer mounts only after verification completes.
