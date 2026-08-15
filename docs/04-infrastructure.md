# Infrastructure

## Supabase — canonical project

| | |
|---|---|
| **Name** | Kiksu |
| **Project ref** | `houicgsdduzzcarxkuuo` |
| **Region** | `eu-central-1` (Frankfurt) |
| **Postgres** | 17 |
| **Status** | Active |

**All migrations, types generation and edge functions target `houicgsdduzzcarxkuuo`.**

### Superseded project — do not use
An earlier project `htwblkemseevvhnzvwdc` ("Kiksu Mobile App") exists in
`ap-northeast-1` (Tokyo). It is empty and retained only so nothing is lost.
Frankfurt is ~60–80ms round-trip from Baku against 250ms+ for Tokyo, and Supabase
regions cannot be changed after creation, so the project was recreated while it was
still empty. Delete the Tokyo project once you are satisfied nothing references it.

## Secrets
Never commit keys. `.env` is gitignored; `.env.example` documents the shape only.
The service-role key must exist **only** on the server layer — never in the Expo
app, where it would be extractable from the bundle and would defeat every identity
protection in `02-identity-spec.md`.

## Regions elsewhere
Object storage and edge functions follow the database region. If counsel later
requires Azerbaijani data residency, this is the decision that changes — see the
legal section of the product plan.
