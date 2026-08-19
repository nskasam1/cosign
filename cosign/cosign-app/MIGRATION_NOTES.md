# Migration notes — Sip → Cosign

> **Historical (superseded 2026-08-15). Do not treat anything below as current
> architecture.** It describes the pre-rebuild app: Supabase, Vercel edge
> functions, Google Places, and pairwise *Elo* ranking. Phase 1 removed all of
> them — persistence is local SQLite behind `server/`, there are no external
> services or keys, and ranking is binary-search insertion into an ordered list,
> never Elo. Kept only as the record of what the Phase 0 audit found.
> The current plan of record is `../../PLAN.md`.

Sip was a solo coffee-logging PWA (Vite + React SPA, Supabase, Vercel edge functions
for Google Places). Cosign is a campus place-recommendation and ranking app built
around pairwise Elo comparisons and a public share link. This is not a rename — the
data model, the core interaction (logging → head-to-head ranking), and the primary
surface (private feed → public share link) are all changing. This file is the sanity
check before touching code, written per the working brief's Phase 0.

## What's actually in the database today (vs. what the code assumes)

Only two tables exist per the applied migrations (confirmed against the generated
`types.ts`, which matches exactly):

- `entries` — one row per drink logged at a place. Has RLS `SELECT`/`INSERT` policies
  scoped to `auth.uid() = user_id`, but **no `UPDATE`/`DELETE` policy**, even though the
  UI edits and deletes entries. This never fully worked correctly under RLS.
- `wishlist` — one row per saved place. RLS is complete (`FOR ALL`).

Code in `useProfile.tsx`, `FriendsView.tsx`, and `ProfileView.tsx` reads/writes a
`profiles` table, a `follows` table, and an `avatars` storage bucket — **none of these
were ever migrated**. The Profile and Friends tabs in the running app are calling
tables that don't exist in this repo's migration history. This is not a Cosign-caused
regression; it's a pre-existing gap. Net effect for planning purposes: there is no
real "profiles" or "social graph" data to preserve — Phase 1's `profiles` and
`friendships` tables are greenfield, not a migration of working data.

Two other pre-existing rough edges, noted so they aren't mistaken for new bugs:
`@lovable.dev/cloud-auth-js` is an installed but unused dependency (real auth is plain
Supabase email/password, not what the README describes); and there are two redundant
Google Places proxies (Vercel `api/places/*.ts`, actually used; a Supabase edge
function `places-search`, unused).

## Tables: survive / replace / new

| Table | Fate |
|---|---|
| `entries` | **Replaced.** Superseded by `rankings` (pairwise comparisons replace the craft/feel star-style scores) plus `shop_snapshots` (time-of-day amenity/crowding data). The place/photo/notes concepts survive conceptually but move onto `shops` + `shop_photos`. |
| `wishlist` | **Replaced.** Superseded by `lists` + `list_items`, which are collaborative and not tied to a single owner. |
| `profiles` (orphaned, never real) | **New, real this time.** Backs the public share-link header. |
| `follows` (orphaned, never real) | **Replaced** by `friendships` (bidirectional accept/pending model, needed for friend-weighted ranking — a one-way follow graph doesn't fit the "friends-only visibility" requirement). |
| `photos` storage bucket | **Kept.** Still the right primitive for `shop_photos`; add a bucket for profile avatars (the thing `avatars` was supposed to be). |

New tables with no predecessor: `shops`, `shop_amenities`, `shop_intent_tags` (+
`intent_tags` fixed enum), `rankings`, `lists` / `list_editors` / `list_items`,
`group_sessions` / `group_session_votes`, `notifications`.

## Components: kept / gutted / dead-on-arrival

**Kept close to as-is** (generic UI plumbing, not coffee-specific):
`src/components/ui/*` (full shadcn primitive set), `MapView.tsx` (pin rendering is
domain-agnostic), `PlaceSearch.tsx` + `api/places/*.ts` (Google Places autocomplete —
directly reusable for populating `shops`), `LocationFilter.tsx`, `LoginScreen.tsx`
(auth form structure, not the branding), `NavLink.tsx`, `use-mobile.tsx`, `use-toast.ts`.

**Gutted and rebuilt on the new schema** (structure/pattern reusable, contents are not):
`AddEntrySheet.tsx` → becomes the head-to-head ranking flow (Phase 3.2), `PlaceCard.tsx`
/ `PlaceDetailSheet.tsx` → becomes the shop detail page (Phase 3.3), `ProfileView.tsx` →
becomes the profile page that also powers the public share link (Phase 3.4),
`WishlistFeedView.tsx` → becomes collaborative lists UI (Phase 4.2), `FriendsView.tsx` →
rebuilt against real `friendships` once that table exists, `StatsView.tsx` → likely
retired in favor of the semester recap card (Phase 5.3) rather than rebuilt 1:1.

**Deleted, not migrated** — star/slider rating UI is explicitly out per the brief
("kill star ratings anywhere"): `DrinkRating.tsx`, `TasteRing.tsx`, `VibeMatrix.tsx`,
`VibeMatrixMini.tsx`, `AddToWishlistSheet.tsx` (superseded by list add-flow).

**Already dead before this rewrite, deleting outright** (unreferenced from any route
per the codebase audit): `EntryCard.tsx`, `CitySwitcher.tsx`, `DiscoveryTabs.tsx`,
`FilterDrawer.tsx`, `WishlistView.tsx`, and the unused `useCityFilter.ts` hook.

**Routing**: `Index.tsx` today is a single 639-line page doing tab-state navigation,
not URL routing — there are no deep-linkable routes. This has to change regardless of
domain, since the share link (`/[username]`, `/[username]/list/[slug]`) and shop detail
pages need to be real, addressable routes. `react-router-dom` is already a dependency
and unused beyond the two-route stub in `App.tsx` — real routes get added there in
Phase 3, no new routing library needed.

## Architecture decision: SSR for the share link, without adopting Next.js

The app is a pure client-rendered Vite SPA today — no SSR, no service worker despite
the PWA manifest. Phase 2 asks for the share link to load under 1s with minimal client
JS and an SSR'd list, plus a dynamically generated OG image.

Migrating the whole app to Next.js to get this one route would be a disproportionate,
hard-to-reverse structural change for one surface. The existing `api/places/*.ts`
Vercel Edge Functions prove the pattern already works in this exact project: any file
under `api/` is auto-deployed as its own serverless/edge function, independent of the
Vite build, with zero `vercel.json` config needed. Phase 2 will use that same pattern —
a new edge function (e.g. `api/s/[username].ts`) that fetches the ranked list
server-side and returns hand-templated HTML (no React SSR needed for a read-only list),
plus a separate `api/og/[username].ts` using `@vercel/og` for the preview image. The
Vite SPA continues to own everything else, including the authenticated version of the
same profile view.

## Naming / branding pass (Phase 0.3, this commit)

- App directory: `cosign/sip` → `cosign/cosign-app`.
- `package.json` name: `vite_react_shadcn_ts` → `cosign`.
- `manifest.json`, `index.html` (title, meta description, OG tags, apple-mobile-web-app
  title): Sip → Cosign.
- Placeholder logo/icons: solid color + "Cosign" wordmark/monogram, replacing the
  coffee-mug branded assets. Real icon design is explicitly out of scope for this pass.
- Deleted unused loose coffee-branded assets that were never referenced from any code
  path: `siplogo.png`, `sipcoffeemug.png`, `transparentmug.png`, `favicon_sip/`.
- Remaining coffee-specific UI copy (e.g. "Share this sip", "Best sip", stat labels)
  is not hand-patched string-by-string — those components are being gutted/replaced in
  Phase 3 per the table above, so patching their copy now would be wasted work.
