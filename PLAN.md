# PLAN.md — Cosign build plan & status

Single source of truth for the phased rebuild. A fresh session resumes from this file
alone: read it top to bottom (including **Appendix: the brief**, which is the only
in-repo copy of the founder's requirements), find the first unchecked box in
**Status**, and continue. Operational commands/gotchas live in `CLAUDE.md`.

**Success definition / moat:** the moat is density on one campus + the share
artifact — not features (competitors: Beli, Corner, Cappuccin, grounds., Recs already
ship the obvious feature set). Stopping after Phase 2 with a polished share page
**counts as success**. Priority is strictly 0 > 1 > 2 > 3 > 4 > 5A > 5B.

- **Working branch:** `build/cosign` (branched from `main` @ `177368b`). One commit
  per acceptance criterion minimum; Phase 0 evidence (install/typecheck/test/build
  outputs) is pasted into the commit message of the commit that added this file.
- **Machine:** Windows 11, Node 24.11, npm 11.6 (no bun installed). App dir:
  `cosign/cosign-app/`.
- **Design skills:** `frontend-design` and `ui-ux-pro-max` are installed at
  `~/.claude/skills/` — invoke both before UI work in every UI phase (2–5B);
  `stop-slop` is also installed and used for the mandatory anti-slop self-review.
  No installation needed.

---

## Phase 0 audit — what this repo actually is (2026-08-15)

**Stack:** Lovable-generated Vite 5 + React 18 (SWC) client-only SPA. TypeScript
(loose), Tailwind + shadcn/ui (full primitive set), react-router 6 (real routes),
react-query, framer-motion, Vitest (+ jsdom), Playwright dep (config broken, zero
specs). A prior rebuild pass (see `cosign/cosign-app/MIGRATION_NOTES.md`) already
renamed sip→cosign, created real routes, and scaffolded a Supabase Postgres schema
(`supabase/migrations/20260811000000_cosign_rebuild_phase1.sql`) plus Vercel edge
functions for an SSR share page (`api/s/[username].ts`) and OG image
(`api/og/[username].tsx`).

**Verified:** `npm install` ✓ · `npx tsc -b` exit 0 ✓ · `npm test` 1/1 placeholder ✓
(~99 s, jsdom startup) · `npm run build` ✓ 45 s (672 kB single JS chunk).
**Not runnable:** the SPA throws at boot (Supabase client with no env), and all four
edge functions error without keys (share/OG return 503; the places proxies 500). No
`.env` exists anywhere. No hardcoded secrets found.

**External-service surface to remove (the whole current data path):**
- Supabase: client (`src/integrations/supabase/`), auth (`useAuth`, `LoginScreen`
  email/password), every page's queries, storage (avatars/photos), analytics sink
  (`src/lib/analytics.ts`), `supabase/` project dir, service-role reads in `api/s`,
  `api/og`.
- Google: Maps JS SDK injected at boot (`src/main.tsx`), `MapView.tsx` via
  `window.google`, Places proxies (`api/places/*`, Vite dev proxy in
  `vite.config.ts`), `@types/google.maps`, Google Fonts CDN import (`src/index.css:1`).
- Platform residue: Vercel (`api/` runtime, `@vercel/og`, `tsconfig.api.json` +
  its reference in `tsconfig.json`), Lovable (`@lovable.dev/cloud-auth-js`,
  `lovable-tagger`, `lovable-agent-playwright-config` imports), 7 expected env vars.

**Brief violations beyond services:** no Log entity (intent tags are per-shop votes;
semester/time-of-day never persisted per visit); ranking is random-pair Elo (RPCs in
Postgres), not binary-search insertion into an ordered list; group sessions vote with
thumbs up/down (banned input class); AdminSeed has 1–3 numeric noise/crowding inputs
and snapshot types are `1|2|3` (banned scale); share URLs are username/raw-UUID
addressed, not tokenized/revocable; no friends-only defaults or visibility model; no
notifications; slider CSS (`.slider-craft/.slider-feel`, `src/index.css:100-209`) and
`ui/slider.tsx` + `@radix-ui/react-slider` still shipped; profile tag filter is a
no-op (`Profile.tsx:72`); Home distance math is `Math.hypot` on raw degrees;
`semester.ts` dates are placeholders with a UTC/local off-by-one; `Onboarding` is
hardcoded to OSU.

**Keepers (verified reusable):** route partitioning in `App.tsx` (public share
surfaces already outside the auth wall); hand-templated SSR share-page pattern +
escapeHtml + chip filter + cache headers in `api/s/[username].ts` (swap data source);
ranked-list-first layout in `Profile.tsx`; one-tap head-to-head shell in
`RankingFlow.tsx:75-101`; ShopDetail presentation (amenity grid, staleness banner,
one-tap "Still accurate?"); Onboarding two-step structure; `EmptyState`, `NavLink`,
`LocationFilter`, `timeBucket.ts`, `participantToken.ts`, `semester.ts` structure,
`cn()`, test setup; domain enums/types in `src/types/cosign.ts` (minus scales/Elo);
shadcn set + Tailwind HSL-var token system; warm dark palette already consistent
across `index.css` / share page / OG / manifest (`#141618` bg, gold `#c8a96e`);
`index.html` + `public/` assets (fully local, Cosign-branded); the Supabase migration
file as a **starting checklist** for the SQLite schema (it is missing Log, share
tokens, visibility — the canonical field list is Appendix decision 6, not the
migration).

---

## Architecture decisions (Phase 0 — settled, don't reopen without cause)

1. **Keep the Vite SPA; add a local server under `cosign/cosign-app/server/`.**
   Hono + `@hono/node-server` on Node 24's built-in `node:sqlite` (no native deps, no
   keys). It owns: (a) SSR share/profile pages as hand-templated HTML (port of
   `api/s/[username].ts`), (b) OG images, (c) JSON API `/api/*` for the SPA, (d) static
   serving of `dist/` in prod mode. Dev: server on **8787**, Vite (8080) proxies
   `/api` + `/s` + `/p` + `/og` to it (replacing the Google proxy config). Run via
   `tsx`. **`npm run prod`** (added in Phase 1) = `vite build` then run the server
   with `NODE_ENV=production` on 8787 serving `dist/` + SSR routes — the Phase 2/5A
   Lighthouse gates run against `http://localhost:8787/s/<token>` (never
   `vite preview`, which bypasses SSR). Full Next.js migration rejected —
   disproportionate for the two surfaces that need SSR; MIGRATION_NOTES reached the
   same conclusion.
2. **Persistence:** single SQLite file `server/data/cosign.db` (gitignored) built by
   `npm run seed` from committed seed sources in `seed/` (JSON/CSV + images). All DB
   access behind repository modules (`server/repo/*.ts`) — schema in
   `server/db/schema.sql`. RLS policies become explicit query-level checks.
3. **Ranking model (decision 3):** each user has one canonical **ordered ranked list**
   (`rankings` → per-user ordered `ranking_entries` with position). Insertion = binary
   search: candidate vs midpoint, better/worse taps, ≤ log₂(n) comparisons; every tap
   persists a `comparisons` row (audit log). Crowd baseline (decision 8) = aggregated
   rank derived from comparisons/list positions in TS, tested — never averaged
   ratings. The Elo RPCs die with Supabase.
4. **Share model (decisions 2/12):** `share_tokens` table (unguessable token, scoped
   to one list or one profile, revocable). Public URLs: `/s/:token` (list),
   `/p/:token` (profile). Username routes stay in-app only. OG endpoints keyed by the
   same token. A share link is the per-list opt-in.
5. **Auth v1:** `AuthProvider` interface; dev implementation = user-switcher over
   seeded users. `POST /api/auth/switch` sets an HMAC-signed cookie (secret generated
   at first run into `server/data/`, gitignored — no key in repo). Client `useAuth`
   reimplemented over `/api/me`. `LoginScreen` (password auth) deleted. Share/profile
   pages never touch auth. "Signup" = stub onboarding: pick an existing seeded user
   or create name + school (against seeded schools) — reworked from the current
   OSU-hardcoded `Onboarding.tsx` in Phase 1's SPA re-point.
6. **Geo/maps:** `GeoProvider` interface, local stub returning a fixed campus
   coordinate; haversine distance in TS (fixes the degrees bug). `MapView`/Google SDK
   removed in v1 (ranked lists first — not a map, decision 2); static coordinate data
   retained for the profile's map artifact in 5A (rendered locally, e.g. inline SVG).
   `PlaceSearch` re-pointed at local `/api/places/search` over seeded shops (its
   manual-entry fallback is the stub pattern). Momentary reads only — coordinates
   from geolocation are never persisted.
7. **Qualitative place data without scales:** noise/crowding become labeled enums
   (`quiet | conversational | loud`; `empty | comfortable | packed`) input as tap
   chips, **captured per `time_bucket` on each log** and aggregated per bucket so
   shop pages show *noise by time of day* (decision 6). Numeric 1–3 types/inputs
   deleted. Functional numbers that are *facts* (outlet count, wifi Mbps, prices)
   are fine — measurements, not ratings.
8. **Group decision mode (decision 8) is redesigned:** not thumbs voting. Each of up
   to 4 participants taps their needs (intent tag + constraints, e.g. outlets /
   open-now / noise level); the mode computes the best intersection from members'
   ranked lists + place data. Thumbs UI deleted. Participant identity stays the local
   `participantToken` (no login).
9. **Visibility model (decision 12):** `visibility` column (`friends | public`) on
   lists, logs, and rankings — **default `friends`**. In-app username routes enforce
   the friendship check in repo queries. A `share_token` deliberately overrides
   visibility for exactly its scoped list/profile — that's the per-list opt-in — and
   revoking the token re-closes it. Never solved by putting auth on share pages.
10. **OG images:** `satori` (JSX→SVG) + `@resvg/resvg-wasm` (no native modules) with
    self-hosted fonts, rendered on demand with disk cache (fallback if wasm falters
    on Windows: pre-render PNGs at seed time). Decided finally in Phase 2; both
    paths are key-free and local.
11. **Analytics:** local `analytics_events` table via `track()` behind an interface.
    **North-star predicate (unambiguous):** count of users who, within a given ISO
    week, have `app_open` events on ≥ 2 distinct days **AND** created zero logs that
    week — the "came back without logging" cohort. Implemented in
    `server/repo/analytics.ts`, unit-tested on seeded events.
12. **Fonts self-hosted** (Google Fonts import removed). Editorial display face +
    clean body face chosen by the design skills in Phase 2 from OFL-licensed files
    committed under `public/fonts/` (anti-slop: not Inter-everywhere).
13. **Evidence tooling:** Playwright (fresh standard config; Lovable config deleted)
    + Lighthouse CLI + axe-core. Screenshots 390×844 (share page also desktop).
    Artifacts committed under `evidence/<phase>/` at repo root. Every UI phase also
    requires: axe/Lighthouse a11y ≥ 95 per surface, a `prefers-reduced-motion` pass,
    and an anti-slop self-review of screenshots (no default-shadcn look, no
    purple-gradient-on-white-card, no Inter-everywhere). No native mechanism needed
    (web-only product).

**Assumptions logged (proceeding without asking):** campus = Ohio State (already
seeded in the prior schema; hero coordinate ~40.0067, −83.0305 near the Oval);
semester field values like `2026-autumn` derive from committed
`seed/academic-calendar.json` (which also fixes semester.ts's placeholder dates and
UTC bug); `IMPORT_FORMAT.md` is **authored by us** as the spec for the founder's
seeding weekend — no founder-supplied document exists anywhere; perf gates are
measured on this machine against the local prod server.

---

## Phase map — files & interfaces

### Phase 1 — Domain, seed, rename
Commit order matters (brief: *first commit is the scoped rename, green build after*):
1. **Rename commit (scoped, small):** the residual sip refs — `README.md:4` rewrite
   (also drops bun/Supabase setup instructions for npm/no-keys) and the
   `Home.tsx:14` comment. Evidence: green `npm run build` **and** `npx tsc -b`
   exit 0 in the commit message.
2. **De-service + cleanup commits:** untrack `.DS_Store`×2,
   `.claude/settings.local.json`×2, `supabase/.temp/cli-latest`; root `.gitignore`;
   delete bun lockfiles (npm canonical), `App.css`, slider CSS + `ui/slider.tsx` +
   `@radix-ui/react-slider`, `@lovable.dev/cloud-auth-js`, `lovable-tagger` (+ its
   `vite.config.ts` hook), `@types/google.maps`, `@vercel/og`, Playwright Lovable
   config files, `api/`, `supabase/`, `src/integrations/`, `MapView`, `LoginScreen`,
   `tsconfig.api.json` + its reference in `tsconfig.json`. Green build + tsc after
   each commit.
3. **Server + schema + seed + SPA re-point** (multiple commits as criteria land):
- `server/`: `index.ts` (Hono), `db/schema.sql`, `db/init.ts`, `repo/{shops,users,
  logs,rankings,lists,friendships,notifications,analytics,shareTokens,scores}.ts`,
  `auth/{cookie,provider}.ts`, `providers/geo.ts`, `import/{takeout,csv,export}.ts`
  (exporter exists so round-trip = import → export → import, tested).
- Schema (SQLite): `schools`, `users` (profile fields merged in), `shops`,
  `shop_amenities`, `shop_photos`, `shop_hours`, `logs`, `comparisons`, `rankings` +
  `ranking_entries` (ordered), `lists` + `list_items` + `list_editors`,
  `friendships`, `share_tokens`, `group_sessions` + `group_needs`, `notifications`,
  `analytics_events`. `visibility` per decision 9.
  - **`logs` (new):** user, shop, `intent_tag`, `time_bucket`
    (morning/afternoon/evening/late_night, auto), `semester` (auto from calendar),
    structured taps (noise/crowding labels + amenity observations), optional photo,
    optional one line ≤ 140 chars, created_at.
  - **Canonical intent tags (decision 5, verbatim, the only nine):** `deep_work`,
    `group_project`, `reading`, `meeting_someone`, `first_date`, `quick_grab`,
    `killing_time` (between classes), `late_night`, `just_the_coffee` ("actually
    here for the coffee"). Used by logs, share-entry chips, group-mode needs, seed.
  - **Decision-6 place data (all ten, explicit):** ① outlets — count + where
    (note), ② noise by time of day (aggregated log labels per time_bucket),
    ③ camp-ability (ok to stay 4 hours), ④ tested wifi speed (Mbps), ⑤ seating
    count / table size (laptop / laptop+friend / mug-only), ⑥ natural light,
    ⑦ bathroom code/access, ⑧ late hours (shop_hours), ⑨ drip + latte price,
    ⑩ student discount.
- `seed/`: `shops.json` (**20+ shops**, High St/campus-realistic, full decision-6 +
  identity data; several deliberately photo-less to exercise the no-photo design),
  `users.json`, `friendships.json`, `logs.json` (with per-log photos),
  `comparisons.json`, `lists.json` (**3–5 ranked lists per user**; hero user's
  canonical ranking has 20 entries with images — the perf-gate page),
  `academic-calendar.json`, `images/` (CC0/stylized, one warm treatment, committed,
  no hotlinking), `takeout/{saved-places.csv,saved-places.geojson}` fixtures;
  `IMPORT_FORMAT.md` (we author it); `npm run seed` loads everything one-shot;
  `npm run prod` script added (decision 1).
- SPA: `src/lib/api.ts` client; `useAuth` over `/api/me` + switcher UI; Onboarding
  reworked to stub signup (pick/create name + school, OSU un-hardcoded); pages
  re-pointed at local API (minimal edits to stay green — visual rebuilds belong to
  later phases).

### Phase 2 — Tokens, share page, OG, perf gate
- Invoke `frontend-design` + `ui-ux-pro-max` **first**; commit
  `cosign-app/src/design/tokens.css` (+ `tokens.md` rationale): palette, type pair,
  spacing, radius, motion. Tailwind consumes vars; later phases never re-decide.
- `server/pages/shareList.ts` (SSR HTML, decision 2 exactly): header = the author as
  a person (name, photo, school, one-line taste summary); entries = photo + one
  honest line + intent tags (designed no-photo fallback, first-class); **filter
  chips at top**; **quiet "make your own" CTA at bottom** → stub onboarding;
  decision-13 semantics: "cosigned by" = people whose ranked lists include the
  place, **friends first**; no standalone cosign button anywhere.
- `server/pages/og.ts`: 1200×630, square-crop-safe, legible at ~300 px, containing
  **author name + photo, list title, top places, cosign count**; image pipeline
  (pre-sized variants at seed time); `/s/:token` + `/og/s/:token`; revocation
  (revoked token → tombstone page, not the list).
- **Perf gate (hard, overrides the stall clause):** Lighthouse mobile Slow-4G vs
  `npm run prod` on the seeded 20-place list **with images**: **LCP ≤ 1.0 s,
  score ≥ 90**; numbers recorded below + in commit message. If unmet after real
  optimization: log numbers here, mark incomplete, stop.
- Playwright: fresh `playwright.config.ts`, `e2e/share.spec.ts`, mobile + desktop
  screenshots, OG snapshot, a11y ≥ 95 + reduced-motion pass, anti-slop self-review →
  `evidence/phase2/`.

### Phase 3 — Logging + ranking
- `src/pages/LogFlow.tsx`: pick place → intent tag → structured taps → optional
  photo/line → done. **≤ 8 taps, zero required keyboard input, one decision per
  step, ≤ 10 s on a phone** (measured: Playwright timed run on throttled CPU;
  wall-clock through the flow). Auto-captured `time_bucket` + `semester`. **Log
  saves first; binary-search insertion starts after save, outside the 10 s budget**
  (`src/lib/insertion.ts` pure state machine + comparison UI reusing the RankingFlow
  shell; persists comparisons + updated ranking_entries). *Written in Phase 0: it
  assumed a RankingFlow shell to reuse, but Phase 1 reduced that page to a 67-line
  read-only list. The comparison screen is `src/pages/PlaceFlow.tsx`, new.*
- Tests: insertion at empty/head/middle/tail; tap-count + timing assertions;
  per-step screenshots → `evidence/phase3/`.

### Phase 4 — Home, discovery, freshness, shell
- `src/components/AppShell.tsx` (bottom tabs ≤ 4: Home, Search, Log (thumb-reach
  primary), You), hero chip "near me, open now, has outlets" (GeoProvider stub +
  shop_hours + outlets), friend-weighted ordering (`server/repo/scores.ts` — friends
  outrank crowd; tested ≠ crowd order), data-age labels from seed timestamps,
  re-verify prompt on stale revisit, finals-week mode from calendar JSON (mock date
  test), designed empty states everywhere (incl. no-photo card treatment).
  Wrapped-style semester recap is **reserved** (logs carry semester for it) — not
  built now.

### Phase 5A — Profile + import
- `server/pages/shareProfile.ts` `/p/:token` (map of places as local SVG, top five,
  signature order (their usual drink — add `signature_order` to users/seed), running
  counts, taste line) + own OG; same hard perf gate; Takeout import
  (`server/import/takeout.ts`) parsing the committed CSV + GeoJSON fixtures, offered
  in stub onboarding + empty states, mapping onto seeded places.

### Phase 5B — Social, notifications, metrics, integrity
- Group mode UI (needs-intersection for 4 seeded users), collaborative lists (a list
  with **≥ 2 contributors** re-ranks), notification feed from persisted human-action
  records — the triggering actions are exactly: friend request received, friend
  request accepted, added as list editor, collaborative list re-ranked by another
  editor, friend asked (group session invite); each notification row references the
  action record that caused it. No scheduled/engagement-bait path anywhere (also no
  streaks/badges/nudges — audit the whole app, not just notifications). North-star
  query verified on seeded events (predicate in decision 11). Integrity tests:
  lists/logs/rankings default friends-only; no geolocation coordinates persisted;
  no pay-for-rank path.

---

## Status

### Phase 0 — Audit & plan ✅
- [x] Git preflight; working branch recorded (`build/cosign` from `main@177368b`)
- [x] Full-repo audit (5-subsystem parallel read; findings above); docs
      adversarially reviewed (3 critics) before commit
- [x] Toolchain verified: install/typecheck/test/build all green (evidence: command
      outputs in the commit message of the commit adding this file)
- [x] Stack, web strategy (local Hono SSR + SPA), evidence tooling (Playwright +
      Lighthouse + axe, 390×844) stated; screenshot mechanism = Playwright (no
      native surface)
- [x] CLAUDE.md + PLAN.md written; no product code touched

### Phase 1 — Domain, seed, rename ✅
- [x] Scoped rename commit (residual sip refs only); build + tsc green (`25d0eb7`)
- [x] De-service/cleanup commits (`938e1a4` hygiene/dead assets; the data-layer
      swap landed with the server — see "Phase 1 commit split" below)
- [x] Schema + repos + one-shot `npm run seed`; `npm run prod` works
      (evidence: `evidence/phase1/commands.txt` — seed from an empty path exits 0
      and builds a 327 kB DB: 22 shops / 8 users / 95 logs / 173 comparisons /
      74 ranking entries / 22 lists / 13 friendships / 4 tokens / 204 events)
- [x] CSV/JSON import round-trips via exporter (`server/import/roundtrip.test.ts`:
      seed → export → seed → export is a fixpoint). The founder-facing CSV is
      wired to real commands: `npm run import:shops` / `npm run export:shops`
- [x] SPA boots against local API (incl. stub-signup onboarding); typecheck + tests
      pass; zero keys anywhere (evidence: `evidence/phase1/` — 10/10 routes render
      with no console/page errors, **every request stayed on localhost:8787**,
      `npx tsc -b` exit 0, 49/49 tests, 0 lint errors)

**Phase 1 commit split (deviation, recorded).** PLAN asked for the de-service
deletions as their own commit ahead of the server. That isn't achievable green:
`@supabase/supabase-js` is already pruned from `node_modules`, so *any* tree that
still contains `src/integrations/supabase/` fails `tsc`. Removing the data layer
and re-pointing the SPA is one atomic change; it landed as a single commit with
full verification output, followed by evidence and this status update.

**Phase 1 decisions & assumptions (new — don't relitigate):**
- **`rankings` table added** (decision 9 was only two-thirds implemented): the
  canonical ranking now has its own row carrying `visibility` (default `friends`),
  alongside lists and logs. `rank.canViewRanking()` is the single read gate.
- **Cosigners are visibility-filtered** (`server/repo/rank.ts`). `cosignersOf`
  returns `{cosigners, others, total}` — it names only rankings the viewer may
  see (self, accepted friends, public) and counts the rest. Before this, a
  logged-out caller could reconstruct every user's whole ranked list with exact
  positions from the public `/api/shops/:slug` route. Regression-tested in
  `server/repo/visibility.test.ts` (12 tests).
- **Crowd aggregates deliberately span friends-only logs.** `intentTallies` and
  `conditionsByBucket` count all logs regardless of visibility, because decision 6
  wants *noise by time of day* on a shop page that logged-out people can read.
  They expose counts and labels only — never identity or authorship.
- **Share tokens are scoped strictly.** A `profile` token no longer renders the
  ranking at `/s/:token` (it 404s until `/p/:token` exists in 5A), and the schema
  enforces `(kind = 'list') = (list_id IS NOT NULL)`. Seed tokens are random
  base64url; the seeder rejects a token that is short, non-random, or equal to a
  username — a readable token would quietly restore the username-addressed page.
- **`u_noah` is the deliberate empty-state fixture** (no ranking, no lists) and is
  exempt from the seeded "3–5 lists per user" floor, which the seeder now enforces
  for every user who has a ranking.
- **Share pages are `noindex` + `Disallow`ed** in `robots.txt`. An unlisted URL
  that search engines index isn't unlisted, and revocation would come too late.
- **Fonts are system stacks for now.** The Google Fonts CDN import is gone; the
  dead `Inter`/`Fraunces`/`JetBrains Mono` *names* were removed from
  `tailwind.config.ts` and `index.css` too, so nothing references a face we don't
  ship. Phase 2 commits the self-hosted pair.
- **`PlaceSearch` is deferred to Phase 3** (it belongs to the log flow). The local
  `/api/places/search` endpoint over seeded shops already exists and is unused.
- **Playwright chromium is installed** on this machine (build v1217) for
  `scripts/boot-smoke.mjs`. Phase 2 adds the full `playwright.config.ts`.
- Main JS bundle dropped **672 kB → 345 kB** as a side effect of de-servicing.

### Phase 2 — Share page, OG, tokens ✅
- [x] Tokens file committed via design skills (`src/design/tokens.css` +
      `tokens.md` rationale); consumed by Tailwind (61 `var(--…)` references in
      `tailwind.config.ts`), by the SPA (`src/index.css` imports it), and by the
      SSR pages (`server/pages/tokens.ts` inlines it). `tokens.test.ts`
      (32 tests) fails the build on a contrast regression, a font that is named
      but not committed, or drift in the copies `og.ts` needs.
- [x] Share page SSR, logged-out; **all decision-2 elements** present and
      asserted, not just screenshotted (`e2e/share.spec.ts`, 24 tests across
      mobile 390×844 and desktop 1280): author header (name/photo/school/taste
      line/usual order), 22 entries each with position + name + honest line +
      intent tags, chips above the list, CTA below the last entry, 3 designed
      no-photo plates, and all three cosigned-by states. Evidence:
      `evidence/phase2/share-{mobile,desktop}.png`, `share-filtered-*.png`,
      `commands.txt`
- [x] OG snapshot committed (`evidence/phase2/og-share.png`) — 1200×630 PNG with
      author monogram + name + school, list title, top three places, and the
      cosign count; satori + resvg-wasm, no key, no browser, ~210 ms cold
- [x] Token revocation works: `/s/<revoked>` → 410 tombstone leaking zero shop
      names, `/og/s/<revoked>` → 410, profile-scoped token → 404 at `/s/`
      (tested; transcript in `commands.txt`)
- [x] a11y ≥ 95 (Lighthouse **100**; axe: 24 passes, **0 violations**) +
      reduced-motion pass (every computed animation/transition is 0 s) +
      anti-slop self-review
- [x] **Perf gate: LCP ≤ 1.0 s, score ≥ 90** — measured **LCP 869 ms,
      performance 100**, FCP 869 ms, TBT 16 ms, CLS 0.023, 7.9 kB gzipped
      document. Median of 5 runs, Lighthouse 13.4.1, mobile + simulated
      Slow-4G, against `npm run prod` on the seeded 22-place list with images.
      Evidence: `evidence/phase2/lighthouse-share.json` (+ full `.report.json`).

**Phase 2 decisions & assumptions (new — don't relitigate):**
- **Direction chosen by panel, not by reflex.** `frontend-design` +
  `ui-ux-pro-max` were invoked first, then four independent share-page
  directions were generated against the real seeded data (broadside /
  photo-essay / field ledger / a free-choice pigment deck), each rendered as a
  working mockup, screenshotted at both viewports, and audited for brief
  compliance and contrast. What shipped is a synthesis. Rationale, the panel's
  three decisive findings, and the full contrast table live in
  `src/design/tokens.md`.
- **`ui-ux-pro-max` is only partly installed on this machine** — `SKILL.md` is
  present but its `data/` and `scripts/` directories are empty, so the CSV
  search tool could not run. Its rule tables were applied directly. Not a
  blocker; noted so a future session doesn't chase the missing script.
- **Type: Young Serif 400 + Karla 400/700**, both OFL, self-hosted, 53 kB of
  woff2 total. All four designers independently picked Young Serif; three of
  four picked Karla over the neutral grotesques. The font *files* are committed
  under `public/fonts/` (and `.woff` duplicates under `server/assets/fonts/`
  because satori cannot parse woff2) — the `@fontsource/*` packages they came
  from are **not** dependencies and nothing fetches a font at build or run time.
- **Colour: two accents with separate jobs.** Ember `#E0633C` is the *ranking*
  voice (numerals, active chip, CTA); gold `#C8A96E` is the *label* voice
  (small caps, intent tags). Deliberately not gold-on-brown, which is the
  reflex and reads stock. The ground `#14100E` is warm to match the seeded
  imagery's own six grounds.
- **Each entry's rank numeral and no-photo plate take that place's own imagery
  palette.** The list carries a colour rhythm drawn from the places rather than
  applied on top of them, and the no-photo state becomes first-class: entry 11
  is `C&V` set in the display face on Cardinal & Vine's clay, not a missing
  picture. All six palettes clear 4.5:1 on both the ground and their plate.
- **Cosigners on a public page are ordered by the author's friendships but
  named only if their own ranking is public** (`rank.cosignersForShare`).
  The author consented to publishing their list; nobody else did, so friends-only
  rankings are counted, never named — otherwise one share link would out every
  friend's private list. To make all three states real, `seed/rankings.json`
  marks june/theo/lena public; the default stays `friends` (4 of 7 seeded
  rankings). The page renders 17 named, 4 counted, 1 "Only on Maya's list so
  far".
- **`INTENT_TAG_LABELS_SHORT` added** for dense surfaces (chips, the entry
  metadata line). Same nine tags; "Actually here for the coffee" wraps to two
  lines in a 390 px column, "Just the coffee" does not. The long forms stay for
  the Phase 3 log flow, where the phrasing is the point.
- **The LCP element is the lead photograph, inlined as a data URI.** The
  document floor on this harness is ~0.82 s, so a second round trip for the
  hero would blow the 1.0 s budget outright. Two consequences worth keeping:
  (a) `hono/compress` is now on for everything — the document is 34.8 kB raw,
  7.9 kB gzipped; (b) the inlined copy has the seeded imagery's `feTurbulence`
  grain **stripped**. That filter rasterises over its full 800×600 user-space
  region regardless of display size and cost ~110 ms of LCP *render* delay under
  4× CPU throttle — it was also the entire source of run-to-run variance
  (LCP swung 760–1365 ms with it, 794–885 ms without). It is invisible at
  354 px wide. Everything below the fold keeps its grain.
- **Perf numbers are noisy on this machine.** Simulated throttling makes the
  network deterministic but scales *observed* CPU time by 4×, so a busy box
  inflates LCP. One run in five still lands ~1.37 s. The gate is therefore
  reported as the median of 5 (`LH_RUNS=5`), and `scripts/lighthouse.mjs` exits
  non-zero when the median misses — it cannot be passed by claim.
- **SEO scores 66 on the share page, by design.** The only failing audit is
  `is-crawlable`: the page is `noindex, nofollow` (decision 12). An unlisted URL
  a search engine has indexed is not unlisted, and revocation would come far too
  late. Not a gated category.
- **Known gap, deferred to Phase 4:** the SPA inherits the new tokens and boots
  clean (`evidence/phase2/spa/`, 10/10 routes, zero console errors, every
  request local), but it is not redesigned — and its no-photo shops still fall
  back to the light `public/placeholder.svg`, which now reads wrong on the warm
  dark ground. The share page's plate treatment is the fix to port.

### Phase 3 — Logging + ranking ✅
- [x] **≤ 8 taps, zero required keyboard, one decision per step, ≤ 10 s timed** —
      measured **6 taps** from cold (entry · place · intent · noise · crowd · save;
      5 from a shop page) against a cap of 8, and a **median 3.59 s** of three runs
      under 4× CPU throttle + simulated Slow-4G (runs 4569/3566/3589 ms, budget
      10 000 ms). The e2e counts its own clicks, checks **on every step** that no
      `next|continue|submit|done` button exists, and asserts zero visible
      `input`/`textarea` on every step of the required path. Evidence:
      `evidence/phase3/{taps-mobile.json,timing.json,commands.txt}`, per-step
      screenshots `step-{1..6}-*.png` at 390×844 **and** 1280 (35 e2e tests pass,
      18 mobile / 17 desktop; the timed run is mobile-only by design)
- [x] **Insertion unit tests: empty/head/middle/tail; insertion runs only after log
      save** — `src/lib/insertion.test.ts` (13 tests) now anchors the four cases to
      the seeded data (u_noah empty; u_lena's list for head/middle/tail) with the
      exact opponent sequence and final position asserted. Save-ordering is
      executable, not claimed: the e2e records request order and asserts the 201
      from `POST /api/logs` precedes any `POST /api/rankings/insert`, and that
      `[data-placeflow]` does not exist in the DOM until it lands. The head/middle/
      tail e2e re-derives the expected midpoint itself rather than trusting a
      memorised list
- [x] **time_bucket + semester auto-captured; no rating-scale input anywhere
      (sweep)** — the receipt on the post-save screen carries the *server's*
      returned values (`data-time-bucket` / `data-semester`, asserted equal to the
      POST response), and the flow never asks. The sweep is now a mechanism, not a
      claim: `src/design/no-scales.test.ts` walks all 117 `.ts/.tsx/.css` files
      under `src/` and `server/` and fails on range/number inputs, `role=slider|
      progressbar|radiogroup`, `aria-value*`, star/thumb glyphs, an `N/5`-style
      score, or an import of a scale-capable primitive — plus the e2e runs the
      share page's DOM assertions on **every step**, not just the last screen
- [x] a11y **0 serious/critical axe violations** across 7 surfaces × 2 viewports
      (14 reports, 18–20 passes each — including the head-to-head itself, not
      just its result), 44 px targets swept on the flow **and** the comparison,
      `prefers-reduced-motion` leaves every computed animation/transition at 0 s,
      anti-slop self-review done against the committed screenshots
- [x] Reviewed adversarially before commit: four independent lenses (brief
      compliance / correctness / test scepticism / design + a11y) produced 37
      findings, each then handed to a separate agent instructed to refute it.
      19 survived and **all 19 are fixed** — see "what the review caught" below.
      The Phase 2 share suite (24 tests) is re-run against the clean seed as a
      regression check and still passes

**Phase 3 decisions & assumptions (new — don't relitigate):**
- **Direction chosen by panel again, then judged.** Three independent designs for
  the flow were generated against the real seeded data (a printed receipt; a
  one-thumb single screen; a friend asking one question per screen), scored by
  three lenses (literal brief compliance / a sophomore in a queue / the designer
  who shipped the share page), and synthesised. What shipped is **the receipt**:
  one small-caps line under the header that is *already half-written before you
  touch anything* (`Evening · Between terms · 3 min walk`, muted, because that is
  what Cosign already knew) and that each answer lands on in gold. That one colour
  rule is how auto-capture is *shown* rather than asked.
- **Ember is starved on purpose.** It appears nowhere on the four asks — they
  auto-advance and nothing persists — so its first appearance *is* the `SAVE IT`
  pill. After the save it has exactly three jobs: the 2 px selection bar in the
  page margin, the 1 px stamp rule that draws itself across the column and then
  **stays above every comparison** as proof the log is safe, and `:focus-visible`.
- **No Next button anywhere in the chain**; back is the undo. That is where the tap
  budget comes from: four auto-advancing steps save five taps, which is what leaves
  room for two optional confirmations inside the cap.
- **Crowd is on the critical path** (so the required path is 6 taps, not 5).
  `shops.conditionsByBucket` aggregates modal crowd per `time_bucket` exactly as it
  does noise, and `ShopDetail` already renders both — an optional crowd would
  starve a shipped feature. Both steps are pixel-identical components, which is
  itself the argument that neither is a scale.
- **The review step is hard-capped at two confirmations** (`confirmationsFor`,
  exhaustively unit-tested over 9 intents × 4 crowd values × every seeded amenity
  row). The worst case is therefore 8 taps *by construction*, not by hope. Gating
  alone was not enough: 14 of 22 seeded shops carry outlets + wifi + camp_ok, so
  gating would have surfaced all four rows 64 % of the time.
- **The optional photo is real, and local.** A stock-image picker was the panel's
  recommendation; it is dishonest data. Instead the extras branch takes a real
  file (`capture="environment"`), downscales it in a canvas to ≤ 1280 px, and posts
  it to a new **`POST /api/uploads`** that is the phase's only new writable
  surface: auth required, data-URL shape enforced, 2 MB decoded cap, **magic bytes
  sniffed** (never the declared mime), filename server-generated from `randomUUID`,
  written under `server/data/uploads/` (already gitignored) and served read-only at
  `/u/*`. `logs.photo` is allowlisted to `^/img/logs/log-\d{3}\.svg$` or
  `^/u/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$`. Still zero external services: no key,
  no CDN, no remote host — the bytes never leave the machine, asserted in the e2e.
- **Five real server defects were found and fixed while building on them**, each
  reproduced before it was fixed (transcript in `evidence/phase3/commands.txt`):
  (a) `POST /api/logs` spread the client body *after* `user_id`, so a signed-in
  client could attribute a log to another user **and set `visibility:'public'`** —
  the friends-only default was advisory, not enforced; (b) `noise`/`crowd` reached
  the SQLite CHECK and surfaced as a 500; (c) `photo` was an unvalidated client
  string (`../../etc/passwd` persisted verbatim); (d) a bogus comparison hit the FK
  *inside* `insertIntoRanking`'s transaction, rolling back a legitimate re-order
  with an unreadable 500; (e) **`insertIntoRanking` never created the `rankings`
  row**, so for anyone who ranked through the API rather than the seeder, the row
  that carries `visibility` (decision 9) did not exist and the share page's "last
  put in order" timestamp never moved. There is now an `app.onError` that maps a
  JSON `SyntaxError` and SQLite constraint failures to 400 rather than 500.
- **`server/index.ts` only binds :8787 when it is the entry module.** It bound at
  import time, so importing `app` in a test hit the EADDRINUSE guard and
  `process.exit(1)`'d the whole vitest run. `npm run dev|prod|serve:prod` are
  unaffected (verified against a real process).
- **Three unused shadcn primitives are deleted** — `progress.tsx` (the only thing
  left emitting `role="progressbar"` + `aria-valuenow`), `radio-group.tsx` (a
  five-item Likert scale in nine lines), `chart.tsx` (a ~370-line recharts wrapper)
  — along with their three dependencies, exactly as Phase 1 removed the slider.
  They were the drawer a step-indicator author would have opened.
- **The slot is not a progress bar.** Progress on the comparison screen is a strip
  of *the user's own ranking* — the live `[lo, hi)` window — collapsing as each tap
  halves it, plus a plain sentence (`Tap 1 of at most 4`). No track, no fill, no
  total, no `aria-valuenow`. A meter with a moving fill is the one shape that would
  read as a scale on a screen whose whole point is that nothing is scored.
- **The Lovable-era utility kit is gone from `src/index.css`** (`.glass`,
  `.gradient-card`, `.card-shine`, `.gradient-text`, `.gradient-accent`,
  `.gold-glow`, `.accent-glow`, `.nav-shadow`) — every one a gradient, glow or
  glass panel, i.e. the exact stock look the brief bans. `LocationFilter` was its
  only consumer and is now a flat ember chip; its ungated framer-motion `whileTap`
  and `layoutId` spring went with it, because those ignore `prefers-reduced-motion`
  on their own. The new surfaces use **no framer-motion at all**: six CSS
  animations, all on the three duration tokens, which `tokens.css` already zeroes.
- **The e2e writes, so it runs against a scratch database** (`COSIGN_DB=…` seeded
  per run by `scripts/phase3-evidence.sh`) and every test that needs an empty
  ranking **signs up a fresh account through the real stub-signup route** rather
  than reusing `u_noah`. Reusing a seeded empty user works exactly once; the second
  test to log finds the state its own suite created.
- **axe must be run after animations settle.** It reported the step glosses at
  4.08:1 because it sampled `#817364` — muted at partial opacity, mid-fade — not
  the resting `#9A8977`, which clears 4.5:1. WCAG applies to the resting state, so
  the fix is `await settled(page)` (awaiting `document.getAnimations()`), not
  repainting a token. Worth remembering the next time a contrast number looks
  impossible.
- **Today is between terms** (2026-summer ended 08-06, 2026-autumn starts 08-25),
  so every log created now stamps `semester: 'break'` and the receipt reads
  "Between terms". The screenshots show the honest current state.
- **Main JS bundle 345 kB → 382 kB** (119 kB gzipped) with the two new pages. The
  share page still ships none of it.
- **Known gap, still Phase 4:** Home, ShopDetail and RankingFlow gained entry
  points and a resume section in the new language, but are otherwise untouched
  Phase-1 holding shapes (rounded cards, lucide icons, `font-black`). The log flow
  is the reference implementation to port from.

**What the review caught (all fixed before commit — worth knowing, not repeating):**
- **The one that mattered:** `PlaceFlow` gated on `isLoading`, which is false for
  a *failed* or offline-paused query too — so an unread ranking was
  indistinguishable from an empty one, and the screen would have auto-committed
  the just-logged place at **#1 with zero comparisons behind it**. It gates on
  `isSuccess` now, with its own designed unreachable state. The rule this
  encodes: on this surface, never infer a rank from an absence.
- **Evidence hygiene, which is an acceptance mechanism here.** The harness re-ran
  the Phase 2 share suite *after* the log suite had filled the database with test
  accounts, and `share.spec.ts` hard-coded `evidence/phase2/` — so it silently
  rewrote seven committed Phase 2 artifacts (the OG image's cosign count moved
  52 → 65, and the "Only on Maya's list so far" state disappeared from the
  screenshot Phase 2 was accepted on) while its own results JSON overwrote Phase
  3's. Now: `share.spec.ts` follows `COSIGN_EVIDENCE`, the regression runs
  **first against the clean seed** into `evidence/phase3/share-regression/`, and
  the two suites no longer share a results file.
- A tapped confirmation survived going back and changing the answer that offered
  it, so a log could carry a claim the user could no longer see. `save()` now
  intersects the taps with what the screen is currently offering.
- `SAVE IT` stayed live while a photo was still uploading, silently dropping it.
- The slot and the tap bound indexed the *live ranking* while the search runs on
  its own list — wrong for the re-rank path, where that list is the ranking minus
  the place being moved.
- `RankingFlow`'s `Promise.all` had no `catch`: one rejected request rendered "no
  ranking yet" to someone whose list was fine.
- Auto-advance dropped keyboard/screen-reader focus to `<body>`; each step's
  question is now focused on mount.
- The axe run and the 44 px sweep never actually reached the head-to-head — the
  audited surface was the already-ranked done screen, because the picker's first
  row is the closest place, which the fixture user had usually already ranked.
- The no-scales guard could not see `<progress>` / `<meter>`, whose scale roles
  are implicit; both the static guard and the DOM assertion cover them now.
- The head/middle/tail e2e borrowed a seeded account and grew it by one place per
  run, so a third re-run without a re-seed would have run out of unranked shops.
  Those fixtures now build their own five-place ranking through the insert route.

### Phase 4 — Home/discovery/shell ✅
- [x] **Hero query correct via stubbed geolocation** — "near me, open now, has
      outlets" is one predicate in `src/lib/discover.ts` (open · outlets ≥ 1 ·
      ≤ 25 walking minutes of the position it is handed), and the position is an
      *argument* all the way down, so the tests move the campus rather than
      trusting it. Standing on the Oval it answers Night Owl (10 min, 18
      outlets); standing on The Foundry's doorstep it answers The Foundry
      (0 min); two miles west it answers **nothing**, which is a designed state.
      The e2e also inspects the request the SPA actually makes and finds the
      stub's coordinate on it (`lat=40.0007&lng=-83.0114`). Evidence:
      `evidence/phase4/commands.txt`, `home-{mobile,desktop}.png`
- [x] **Friend-weighted ≠ crowd order** — and it is a *tier*, not a weight:
      every place somebody you know has ranked sits above every place nobody
      you know has, at any crowd size. `server/repo/scores.test.ts` +
      `discover.test.ts` prove it against a unanimous crowd of fifty (17+22
      tests), and the same guarantee is asserted on the rendered page. It is
      also **visible in the product**: Home can show you the crowd's order and
      says how many places move (`20 of 20` for Lena on the seeded campus).
      Evidence: `friend-vs-crowd-{mobile,desktop}.json`, `home-crowd-order-*.png`
- [x] **Data-age labels + re-verify prompt** — every row states its age in
      words from the seed timestamps, in three bands: silent under 21 days,
      a muted clause to 60, and past 60 the facts themselves fall out of the
      gold label voice while the caveat is set *brighter* than the facts it
      qualifies. The re-verify prompt is asked of exactly one person — whoever
      has been in since the facts were last confirmed — and everybody else is
      told without being asked to vouch for what they did not see. Evidence:
      `shop-reverify-*.png`, `shop-stale-stranger-*.png`, `shop-verified-*.png`
- [x] **Mocked finals week changes Home** — from the calendar JSON, with no
      date hook in the running server: `COSIGN_CALENDAR` points a second server
      at a generated fixture whose finals week contains today, and
      `scripts/phase4-evidence.sh` runs both. The same build, same database,
      same clock: `phase=break mode=usual hero=Night Owl` on :8787 versus
      `phase=finals mode=finals hero=The All-Nighter` on :8788 — plus a section
      that exists in no other week (still open in four hours, off `shop_hours`).
      Evidence: `finals-{mobile,desktop}.json`, `home-finals-*.png`
- [x] **Shell + empty states in screenshots** — `src/components/AppShell.tsx`:
      four words on a hairline (Home · Search · Log · You), no icons, no
      badges, Log primary by face and enclosure rather than by a filled
      lozenge, absent from the log flow, the head-to-head, onboarding and the
      public share page. Every empty state rewritten as a designed screen
      (`src/components/Nothing.tsx` replaces the Phase-1 `EmptyState`, whose
      centred icon in a rounded grey square was the most stock shape in the
      app). Evidence: `empty-{ranking,search}-*.png`, `home-no-friends-*.png`,
      `search-*.png`, `profile-*.png`
- [x] a11y **0 serious/critical axe violations** across 6 surfaces × 2
      viewports (12 reports, 22–27 passes each — including the re-verify
      prompt, audited while it is on screen rather than after the test has
      answered it), 44 px targets swept on every destination,
      `prefers-reduced-motion` leaves every computed animation/transition at
      0 s, anti-slop self-review done against the committed screenshots
- [x] Reviewed adversarially before commit: four independent lenses (brief
      compliance / correctness / test scepticism / design + a11y), each
      finding then handed to a separate agent instructed to refute it — see
      "what the review caught" below. The Phase 2 (24) and Phase 3 (35) e2e
      suites re-run as regressions against the clean seed and still pass; the
      SPA boot smoke covers 11 routes with zero console errors and every
      request on localhost

**Phase 4 decisions & assumptions (new — don't relitigate):**
- **Direction chosen by panel again, then judged.** Three independent designs
  for Home and the shell were generated against the real seeded data (a printed
  front page; the answer then the room; a continuity direction that adds the
  fewest possible new shapes), each rendered as a working mockup at 390 px and
  screenshotted, then scored by three lenses (literal brief compliance / a
  sophomore in a queue at 11pm on 14% battery / the designer who shipped the
  share page). No direction broke a hard rule. What shipped is a synthesis:
  continuity's structure and row anatomy, the front page's shell treatment and
  its crowd-order toggle, the answer direction's freshness attribution.
- **The hero query is the page's headline, already answered on arrival.** The
  brief asks for a "one-tap hero query"; this is zero taps — the question is
  the largest editorial line on Home and the answer is under it. The tap it
  *does* have is "ask again", which re-reads the position. Two judges
  independently said the answer must outsize the question, so the question is
  23 px and the answer's name is 44 px.
- **Two orders, kept apart and both labelled.** The ANSWER is chosen by the
  query (nearest; in finals week, the one you can sit in longest). The COLUMN
  is chosen by your people. Blending them would let "near me" quietly outrank a
  friend's #1, and the brief asks for both separately (#7 and #8).
- **"Friends outrank the crowd" is lexicographic, not a weight** — this
  supersedes decision 8's "friend-weighted" phrasing, and the weight is gone.
  The order is: (1) has anybody you'd actually ask put it in order; (2) if so,
  how highly do *they* rank it — a mean over your own and your friends' lists
  with **no stranger in the arithmetic at all**; (3) otherwise, and to break
  their ties, the crowd baseline; (4) then the walk. Keys 1 and 2 are separate
  because a place a friend ranked *last* scores 0.0 for them exactly like a
  place they have never been, and those are not the same statement.
  A weighted mean cannot carry an invariant: at any fixed weight enough
  strangers outvote your friends, so the guarantee fails exactly when a campus
  gets dense — which is the moat. The review caught that the first cut had the
  tier right and the *within-tier* ordering still decided by the crowd, so a
  friend's #1 could sit below their #9. `discover.test.ts` now proves both
  levels against a unanimous fifty. The cost is deliberate and visible: a
  place one friend ranked near the bottom leads a place the whole campus loves
  and nobody you know has been to, and every row says which it is, in names.
- **Only accepted friends are ever named on a discovery surface** — stricter
  than the share page, which may name a stranger whose ranking is public.
  Here "friends first" means friends only, so the line cannot leak anything the
  viewer could not already open. Two names per row is a hard cap, tested: with
  three you could walk the column and reassemble a friend's whole ordering.
- **Home can show you the order it is not giving you.** "Show the crowd's
  order" plus "N of M move when your friends count for more" turns the
  phase's headline claim from a passing test into something a person can tap.
  It is also the best in-product evidence that rank is not for sale.
- **The re-verify prompt is asked of one person, and the route agrees.**
  Whoever has been in since the facts were last confirmed — the last person
  through the door — gets the ask and the ember commit pill. Everybody else
  gets the caveat and no button, because confirming something you did not see
  is exactly the unverified data the feature exists to prevent, and an ask
  everyone gets is a nag. `POST /api/shops/:id/verify` enforces the same rule
  and 403s otherwise: the freshness signal the whole of brief #10 rests on
  cannot be a client-side suggestion. It lives on the place page, not on Home:
  asking twenty-two questions of somebody who opened the app to be told one
  thing is how you train people to ignore you.
- **Finals week changes the answer, never the question.** The predicate is the
  brief's in both weeks; what changes is which match wins (somewhere you can
  stay, open longest), the copy, and one section that exists in no other week.
  `COSIGN_CALENDAR` is configuration, not a test hook — the academic calendar
  is a file the way the database is a file, and nothing in the running server
  can move the date. The Phase 4 evidence run generates its fixture from
  today's date so it never needs re-dating.
- **`minutesUntilClose` joins midnight.** `isOpenAt` clamps a same-day window
  at 1440 because minutes stop there — the shop does not. Night Owl at 23:30
  has 150 minutes left, not 30, and The All-Nighter (00:00–24:00, Thursday to
  Sunday) is open for 86 hours, not 14. Without the join it would lose the
  finals tiebreak to a place that shuts at 8pm.
- **The shell's Log is not the ember pill.** Ember has two jobs — rank, and
  the live one — and a filled lozenge in the bar on every screen forever would
  be the loudest object in the app, permanently, for a destination rather than
  for an act. Log is primary by face, case and enclosure: the display serif in
  title case between two hairlines. The pill stays where it means something.
- **Freshness has three bands, and the caveat outranks the facts.** Silent
  under 21 days; a muted clause to 60; past 60 the facts leave the gold label
  voice and the caveat is set brighter than the facts it qualifies, so a row
  reads stale before a word of it is read.
- **`isStale` moved to `src/lib/freshness.ts`** with the data-age labels it
  shares a threshold with, and is deliberately not re-exported from
  `timeBucket.ts`: one definition, one import path. The month in a stale label
  is read off the timestamp's own date part, never through the viewer's clock —
  otherwise March is renamed February for anyone west of the shop.
- **Three more dead files deleted** — `EmptyState.tsx` (the centred-icon grey
  square), `LocationFilter.tsx` (the last lucide import outside `ui/`, and
  unused), `NavLink.tsx` (unused). Same reasoning as Phase 1's slider and
  Phase 3's progress/radio-group/chart: an unused primitive is the drawer
  somebody opens later.
- **A logged-out reader gets the crowd's order and nobody's name**, and a
  brand-new account gets exactly the same — which is honest, and is why the
  no-friends Home says so in words rather than pretending to personalise.
- **Main JS bundle 382 kB → 392 kB** (123 kB gzipped) with Home, Search and
  the shell. The share page still ships none of it.
- **Queries retry once, half a second apart** (`App.tsx`), not react-query's
  default three with exponential backoff. Every screen in this phase has a
  designed thing to say about not reaching the server; making somebody watch
  "Looking…" for seven seconds before it is allowed to say it is its own kind
  of dishonesty.
- **`COSIGN_EVIDENCE` no longer defaults to a signed-off phase.** It was
  `phase2` in `playwright.config.ts` and `phase3` in `e2e/fixtures.ts`, so a
  bare `npx playwright test home.spec.ts` wrote Phase 4 screenshots into
  `evidence/phase3/` and overwrote Phase 2's committed results JSON — the same
  trap Phase 3 fixed one level down. Both now default to `evidence/scratch/`,
  which is gitignored.
- **Known gaps, deferred:** the Wrapped-style semester recap stays reserved
  (logs carry `semester` for it); group mode and collaborative lists are 5B;
  and `index.html` still gives every SPA route the same `<title>`, which is a
  Phase-1 condition this phase did not introduce and did not fix.

**What the review caught (all fixed before commit — worth knowing, not repeating):**
Four lenses produced 33 findings; each went to a separate agent told to refute
it, and 13 survived. All 13 are fixed. The ones worth remembering:
- **The tier protected membership, not order.** "Friends outrank the crowd"
  held for *which* places led, and then handed the ordering of your friends'
  own picks back to the crowd — a friend's #1 could sit below their #9. The
  friend score has no stranger in it at all now; see the decision above.
- **`minutesUntilClose` only joined runs that met exactly at midnight.** The
  All-Nighter is 07:00–01:00 Monday to Wednesday and round-the-clock Thursday
  to Sunday: at 2pm on a Wednesday those two windows *overlap*, so it is open
  for 106 hours and the old code reported eleven. In the committed calendar's
  real finals week (which starts on a Wednesday) that handed the finals hero
  to a place that shuts at 8pm.
- **Search could not tell a failed request from an empty campus** — exactly
  the Phase 3 defect, one surface over, and it would have blamed filters the
  user never set for a dropped connection. It gates on absent data now (not on
  `isError`, which misses the offline-paused case) and has its own designed
  unreachable state.
- **Fact separators were painted in `--rule-strong` — 1.68:1**, a contrast
  failure axe reports as "incomplete" and therefore never fails on. The share
  page had set the identical character in `--muted` since Phase 2; the SPA now
  matches it, including the Phase 3 receipt that had the same bug.
- **`POST /api/shops/:id/verify` had no entitlement check at all**, so the
  freshness signal was enforced only by the screen that offered it.
- **`confirmFresh` had a `finally` with no `catch`**: a failed write flipped
  the button back to "Still right" and said nothing, and the one person who
  can answer would reasonably believe they had.
- **Two tests could not fail.** The share-page shell assertion sat behind
  `if (live)` and the viewer owned no share token, so it never ran; and "Log
  is the one that writes" asserted an attribute the component derives from
  the tab's own key. The first mints a token; the second follows the tab.
- **Three fixtures had expiry dates** — a "fresh row" that stops existing 21
  days after the seed's last check, a hard-coded stale slug the suite itself
  consumes, and a shop page the freshness suite makes fresh before the axe
  sweep audits it. All three are now derived from the data at run time.

**What the review caught (all fixed before commit — the rest):**
- **A `fullPage` screenshot of a sticky shelf is a lie.** The shell is
  `position: sticky; bottom: 0`, so a full-page capture lands it wherever the
  scroll happened to be — across the middle of a row. `shotViewport()` captures
  what the phone actually shows, and the two full-column shots scroll to the
  bottom first so the shelf sits where it belongs.
- **`[data-home]` also marked the loading screen**, so a test could read an
  empty column and conclude the rows were missing. It failed only under load —
  the dry runs were fast enough to miss it. The loading state carries
  `data-state="loading"` now and the suite waits for the column, not the main.
- **`Number("")` is 0**, which is a perfectly finite coordinate in the Gulf of
  Guinea: `?lat=&lng=` placed the viewer at the equator. Empty parameters are
  refused before they are parsed.
- **A scrollable strip of nothing but images has no focusable child**, so a
  keyboard user could not reach the shop page's photographs at all. axe caught
  it; the region is focusable now.
- **The evidence run's own ordering was rewriting its own screenshots.** The
  Phase 3 log suite drives the real log flow as `u_lena` and therefore grows her
  ranking, so running it before the Phase 4 suite produced Home screenshots
  showing "your second" against a place she has never been. Phase 4 now runs
  second, against the clean seed, and Phase 3 — which writes most and builds its
  own fixtures — runs last.
- The re-verify test hard-coded a seeded (user, shop) pair, and answering the
  prompt *writes*: it worked exactly once, and the second run found the state
  its own first run had created. It builds its own fixture now — the Phase 3
  lesson, applied before it bit.
- A `<button>` wrapped an `<h1>`, which is invalid (a button may contain only
  phrasing content). The button sits inside the heading instead.
- "None of them anyone you know" was true on every row of a friendless
  account's Home — the same eight words twenty times, under a section that had
  already said it once.
- `.cs-word` sets a minimum *height* and nothing about width, so ListDetail's
  "off" was a 40 px target — on the one destination the 44 px sweep did not
  visit. Both fixed; `/lists/:listId` is in the sweep now.
- Onboarding's three-place cap silently ignored the twentieth tap: no pressed
  state, no message, no `aria-disabled`. It says "that's three — drop one
  first" and announces itself now.
- Nothing was the entire content of eight screens that then had no `<h1>` at
  all. It takes a `standalone` prop and renders its title as the heading.
- The sticky shelf had no `scroll-padding-bottom`, so a tabbed-to row was
  scrolled to the viewport edge and landed underneath it — with the facts line
  and the freshness caveat covered.
- ShopDetail's cosigner sentence named the first eight and then counted only
  the rankings the viewer may *not* read, so a place with 21 cosigners read as
  12. The remainder is computed from the total.

### Carried-forward gaps — closed before Phase 5A ✅
Everything this file and CLAUDE.md still recorded as deferred, plus one defect
found while closing them. Evidence: `evidence/phase5a/gaps.txt`.
- [x] **Every SPA route names itself.** `index.html` gave all twelve routes the
      title `Cosign` — a Phase-1 condition Phase 4 named and did not fix. Titles
      now come from `src/lib/title.ts` (`useTitle`, ~30 lines, no library), which
      takes `null` while a data-derived name is in flight so a tab never keeps the
      *previous* screen's name — the one failure mode that would make this worse
      than leaving it alone. Checked behaviourally, not statically:
      `scripts/boot-smoke.mjs` reads `document.title` off each running route,
      asserts a per-route pattern, and fails if every route agrees.
      **9 distinct titles across 12 routes**, all 12 booting clean.
- [x] **The browser chrome is the token ground.** `index.html`'s `theme-color`
      and `manifest.json`'s `theme_color`/`background_color` were `#141618` — the
      pre-token palette — against pages painted `#14100E` since Phase 2, i.e. a
      cooler grey status bar butting against a warm page on the one surface CSS
      cannot reach. `tokens.test.ts` now guards all four hand-written copies
      (both files plus the SSR page's and the tombstone's `<meta>`), the same way
      it already guarded `og.ts`.
- [x] **`public/placeholder.svg` deleted.** The light no-photo asset Phase 2
      recorded as reading wrong on this ground; `PlacePlate` replaced it in
      Phase 3 and nothing had referenced it since. Same reasoning as Phase 1's
      slider and Phase 3's progress/radio-group: an unused primitive is the
      drawer somebody opens later.
- [x] **A `prefers-reduced-motion` violation, found while closing the above.**
      `RequireAuth`'s loading state was a `border-primary` spinner on
      `animate-spin` — Tailwind's own `spin 1s linear infinite`, which none of
      the reduced-motion blocks in `tokens.css` or `index.css` reach, because
      they zero the *duration tokens*. It was the last Phase-1 holding shape in
      the shell and the only screen in the product that answered a question with
      a shape instead of a sentence; it is now a line of small caps.
- [x] CLAUDE.md's conventions section corrected: it still pointed at
      `semester.ts`, deleted in Phase 1 and replaced by `calendar.ts`.

**Not closed, deliberately:** the SPA's single 394 kB JS chunk (code-splitting
is still unaddressed — it is not on any acceptance criterion, the share page
ships none of it, and the public profile page in 5A must ship none of it
either); the eight `react-refresh/only-export-components` lint warnings, all in
generated shadcn primitives that `components.json` says not to hand-edit.

### Phase 5A — Profile + import ◐ (built and evidenced; the perf gate is NOT met)
- [x] **`/p/:token` renders logged out, with every 5A element** — map of places as a
      local SVG, the top five in their own words, signature order, running counts and
      the taste line, all first-class and all asserted rather than screenshotted
      (`e2e/profile.spec.ts`, **46 tests** across mobile 390×844 and desktop 1280).
      Every state is a seeded fixture and every one is in the evidence: 22 places
      (Maya), a campus with nothing on it (Noah), a profile whose ranking link has
      been revoked so the onward door is closed (Dev), and a revoked profile token
      (Lena → 410 tombstone). A `ranking` token 404s at `/p/` exactly as a `profile`
      token has 404'd at `/s/` since Phase 2 — a token opens one surface, never two.
      Evidence: `evidence/phase5a/{commands.txt,profile-*.png}`
- [x] **Its own OG card**, and visibly not the list card: the list card is a column of
      type between palette rails, this one *is* the map — 1200×630, the drawing at
      400 px centred (so a square centre crop keeps all of it), then the name, the
      count and `RANKED, NEVER RATED · NEVER BOUGHT`. `renderProfileOgImage` in
      `server/pages/og.ts`; the e2e asserts the two cards are different bytes.
      Evidence: `evidence/phase5a/og-profile.png`
- [x] a11y **0 serious/critical axe violations** across 2 surfaces × 2 viewports
      (4 reports, 12–24 passes each), headings run 1→2→3 with no jumps and nothing is
      a styled div, 44 px targets swept, `prefers-reduced-motion` leaves every
      computed animation/transition at 0 s, anti-slop self-review done against the
      committed screenshots
- [x] **Takeout fixtures import in onboarding + empty states (test)** — offered in
      stub onboarding *and* on an empty ranking; `server/import/takeout.ts` +
      **47 unit tests** against the committed fixtures. Of 15 saved places it knows
      10 outright, asks about 1, and names the 4 it does not have. It creates a
      **list, never a ranking**, and the e2e proves the ranking stays empty.
      Evidence: `evidence/phase5a/{commands.txt,import-*.png}`
- [ ] **Perf gate NOT met: LCP 1280 ms against the 1000 ms budget** (performance 100,
      a11y 100, FCP 1205 ms, TBT 0 ms, CLS 0.027, document 25.9 kB raw / 6.9 kB
      gzipped — well inside the 30 kB budget the e2e asserts). Median of 5,
      Lighthouse 13.4.1, mobile + simulated Slow-4G, against `npm run prod`.
      `scripts/lighthouse.mjs` exits non-zero and the transcript records
      `gate exit=1`. **Diagnosis and the two control experiments are below.**

**Phase 5A decisions & assumptions (new — don't relitigate):**
- **Direction chosen by panel again, then judged.** Three independent directions for
  `/p/:token` were generated against the real seeded data (the map as the artifact;
  the person as a printed document; their year in places), each rendered as a working
  standalone mockup, screenshotted at 390 and 1280 and audited, then scored by three
  lenses (literal brief compliance / a sophomore who was just sent the link / the
  designer who shipped the share page). What shipped is a synthesis: the survey
  sheet's frame and computed finding, the dossier's fold — **the taste line, unquoted,
  as the largest thing on the page** — and its five-row anatomy, plus one section of
  arrival history set as prose.
- **`--ink` is their voice; `--line` is ours.** On `/s/` the taste line is a 19 px
  citation in `--line`; here it is the document, in `--ink`, at 28/34 px. That
  escalation is the whole difference between a list's header and a profile, and it is
  asserted in the e2e (the taste line is set larger than the name).
- **Ember appears exactly three times on the page:** the one line from the Oval to
  their first place, the CTA, and `:focus-visible`. Every other coloured mark takes
  the place's own imagery palette, so a numeral in the list and its disc on the sheet
  are visibly the same place.
- **NO PRONOUNS ANYWHERE, and it is a test.** Cosign asks for a name and a school and
  has never been told anybody's pronouns; this is a public page about a real person.
  Every sentence the page or the map can emit is built from the first name instead
  (`computeFinding(places, first, who)`), and both a unit test and the e2e sweep the
  rendered text for `she|he|her|his|him` outside the author's own quoted sentence.
  The design panel's copy used "she" throughout; that was the first thing cut.
- **The map says something the list cannot, or it is wallpaper.** `computeFinding` has
  five rules and the first that qualifies wins. Maya's three nearest places are her
  9th, 17th and 19th and her top five average a fourteen-minute walk — so the sheet
  brackets those three and the caption says so in words. It is derived, never
  asserted: `server/pages/profileMap.test.ts` (28 tests) proves the rule fires on the
  seeded data and that a relabelled ranking flips it to the opposite sentence.
- **The three ordinals are printed ascending by RANK, deliberately not in the order
  the three marks lie on the sheet.** Three numbers beside three places invites a
  reader to pair them up one for one, and that pairing would be invented.
- **A map that leaves a place out to look tidier is lying.** The extent only ever
  grows: it is the bounding box of every ranked place ∪ the campus, floored at ±600 m,
  padded 10 %, then fitted to the plate's aspect by growing the short axis. The frame
  is therefore drawn by where that person goes — Maya's campus is 2164 m across,
  Lena's 1763 m — which is the page's whole claim.
- **The projection uses the cosine of the MEAN latitude, not the origin's.** That is
  the first-order match to the haversine the rest of the app uses; the origin-only
  version drifts ~3 m at a kilometre, which is invisible on the sheet but means the
  picture and the walking time printed beside it come from two different Earths.
- **Marks are a drawing, labels are HTML — and the drawing is an `<img>`, not inline
  SVG.** Measured, not assumed: inline, its forty-odd nodes cost **737 ms of style and
  layout** under Lighthouse's 4× CPU throttle, against 218 ms for the same page with
  no sheet on it. As a data URI it costs the DOM nothing. Labels stay HTML because SVG
  `<text>` in a 390-unit viewBox renders at 11 px on a phone and 14.4 px on a desktop
  with no way to override it — the one figure on the page would be the one place whose
  type escaped the token scale.
- **`server/pages/tokenHex.ts` is now the ONE hand-written copy of the tokens.** Two
  renderers cannot read CSS custom properties: satori, and an SVG inside an `<img>`
  (a separate document with no `:root`, where a surviving `var()` draws *nothing* —
  a mark that silently disappears from a map is the worst failure this page has).
  `tokens.test.ts` guards that copy and now also fails on a literal hex appearing
  anywhere else under `server/pages/`.
- **Concentric rings could read as a target on the one product where nothing is
  scored.** The defence is three real properties, not a promise: the rings are
  labelled in *walking minutes* (a measurement, which decision 7 explicitly permits),
  the top-ranked marks sit *outside* them, and the caption's whole point is that rank
  runs against distance. The e2e asserts every ring label matches `^\d+ MIN$` and that
  the drawing carries no scale role, no `aria-value*`, and no `<progress>`/`<meter>`.
- **The profile is stricter than the share page about other people.** Cosigners are
  computed by the same `rank.cosignersForShare` — ordered by the author's friendships,
  named only if their own ranking is public — but with **no faces**. An avatar is a
  stronger disclosure than a name for somebody who opted only their *ranking* into
  public, and this page is a stronger context than a shared list. Three images on the
  whole page, asserted: the author's avatar, the drawn sheet, the closing photograph.
- **The order past five is not this page's to give away.** PLAN's line item says *top
  five*, so the five carry their positions and the other seventeen are named
  alphabetically with no position at all — a legend for the map, not a ranking.
- **The onward link is derived from a live `ranking` token and addressed by it.**
  Never a username, never a slug: a readable public URL would quietly undo the
  tokenised addressing the whole model rests on. Revoking the ranking's link closes
  this door too, and the e2e proves it on `u_dev` (no `/s/` href anywhere on the page).
- **"The order has a history" says only what the schema can support.**
  `ranking_entries` stores `inserted_at` and `position` and *no history of positions*,
  and `insertIntoRanking` rewrites `inserted_at` on a re-rank. So two sentences compare
  arrival against *current* position (both derivable) and the third — "walked straight
  in at eleventh" — is said of the most recent arrival alone, because nothing has been
  written since it landed. It must never be generalised to any other entry.
- **The Takeout fixtures were rewritten, and the reason is the finding of this phase.**
  As committed in Phase 1 their coordinates had been authored independently of
  `seed/shops.json`: "Wheelhouse Coffee" sat 41 m from *Oval Grounds* and 545 m from
  Wheelhouse. That is not what a real export looks like. They now agree — and they
  carry **two deliberate traps**: `Batch & Crumb Bakery` 48 m from Bramble and
  `Juniper Bar & Kitchen` 24 m from Juniper Coffee Club, sharing a word with it.
  **A coordinate is never, on its own, a reason to say two records are the same
  place.** The name is the identity; the pin corroborates it, or vetoes it when the
  name matches something a mile away. Match on proximity and you write a bakery
  somebody has never been to into their list under a coffee shop's name, with no undo
  anywhere in the flow.
- **A near-miss is offered, not assumed.** `Hackberry` (for Hackberry Roasters) arrives
  as a `likely` match: unpressed, with the reason spelled out, doing nothing until
  somebody taps it. And the four places we do not have are *named on screen*, because
  "we took 10 of your 15" is only honest if you can see which five.
- **The import reads coordinates and keeps none.** They are used in memory to tell two
  places apart and dropped; the API response carries no coordinate and no address, so
  the only thing that outlives the request cannot leak one. The evidence sweeps all 19
  tables for a coordinate and an address that appear only in the export: 0 hits.
- **It makes a list, never a ranking** — an order comes from the head-to-head and from
  nowhere else. `POST /api/lists` now accepts its items, so eleven places land in one
  request rather than eleven: a dropped connection must not leave half a list with
  nothing to say which half.
- **Main JS bundle 392 kB → 400 kB** with the import surface. Neither public page ships
  any of it, and `profile.spec.ts` asserts the profile requests zero `/assets/*.js`,
  zero stylesheets and — unlike the share page — **zero script tags at all**, because
  nothing on it is interactive.

**The perf gate: what was measured, and why it is not met.**

The gate is `LCP ≤ 1.0 s, performance ≥ 90`, median of 5, mobile + simulated Slow-4G,
against `npm run prod`. Measured: **LCP 1280 ms, performance 100** — the LCP half is
missed by 280 ms. Two optimisations were made and both are kept: the sheet moved out of
the DOM into an `<img>` (−520 ms of throttled style+layout), and the `@font-face` rules
moved out of the head-inlined CSS to after the content (`tokensCss({fonts:false})` +
`fontFaceCss()`), which took the median from 1280 to 1205 in isolation.

The remaining gap is **not in the page**, and the transcript proves it with two controls
run on the same machine in the same minute:

| | median LCP | |
|---|---|---|
| the share page (identical three fonts) | **763 ms** | passes |
| the profile, 22 places | **1280 ms** | fails |
| the profile template with **no map on it at all** | **1206 ms** | fails |

A profile with nothing drawn on it measures the same as one with twenty-two places, so
the map is not the cost. What decides the number is an ordering accident: Lighthouse's
pessimistic graph charges FCP for every font request that *completed before the observed
paint*, and on localhost the fonts arrive in about a millisecond, so which side of the
paint they land on is a coin flip. The same run's own trace shows it —

```
share (control)   observed FCP  127 ms | last font at  121 ms | fonts land BEFORE the paint | simulated LCP 1433 ms
profile           observed FCP  134 ms | last font at  126 ms | fonts land BEFORE the paint | simulated LCP 1280 ms
```

— the share page's 1433 ms outlier is precisely the run where *its* fonts landed first.
The profile's own runs contain an 811 ms one for the same reason. Observed (unthrottled)
FCP is 118–134 ms, and `font-display: swap` means text on a real phone paints in the
fallback and waits for nothing.

So the honest position is: **the criterion is not met on the median, and the number is
dominated by a harness artefact rather than by the page.** Per this plan's own rule the
numbers are logged and the box stays unchecked; it is not claimed as a pass. What would
actually close it is beyond this phase: subsetting Young Serif (26.6 kB of the 52.9 kB
on the wire) to the glyphs the product uses, which needs a font toolchain this repo
deliberately does not have.

### Phase 5B — Social/notifications/metrics/integrity ✅
- [x] **Group intersection-best for 4 seeded users** — the four who are pairwise
      accepted friends (Maya, Dev, June, Theo) answer through the real routes and
      the page answers **Lantern Lane Cafe**, which is on two of the four lists
      and in nobody's bottom half. Nobody votes: `group_needs` has no vote column
      and no tally exists anywhere. The needs union into constraints (`3 outlets`
      because three of them asked; `no louder than conversational` because that
      is the strictest ceiling anybody set; `a table for 4`, which nobody has to
      ask for), and the arithmetic is printed on the page: 22 → 11 ruled out →
      5 held because nobody has logged how loud they get at this hour → 6 clear
      everything. Evidence: `evidence/phase5b/{commands.txt,group-*.png}`,
      `src/lib/group.test.ts` (23) + `server/repo/group.test.ts` (20)
- [x] **Collab list with ≥ 2 contributors re-ranks** — "our ranking of campus
      coffee" (Maya + Dev + June) re-ranks from their own head-to-head lists,
      **4 of 6 move**, the other two contributors are told and the one who did it
      is not, and a second re-rank is refused because it would move nothing. Two
      places share third and there is no fourth. A second seeded list (Dev +
      Theo) carries a place neither has ranked, which gets no numeral at all.
      Evidence: `evidence/phase5b/{list-before,list-after,list-unranked}-*.png`,
      `src/lib/collab.test.ts` (16) + `server/repo/collab.test.ts` (10)
- [x] **Notification feed human-action-only; no engagement-bait anywhere** —
      37 notifications in the evidence run, **0 pointing at a record that does
      not exist**, 0 where the recipient is the actor, and exactly the five types
      the brief allows. The database refuses a sixth (including `friend_logged`,
      which was in the CHECK and was cut). The audit is a mechanism, not a claim:
      `src/design/no-bait.test.ts` walks every `.ts/.tsx/.css/.sql` under `src/`,
      `server/` and `e2e/` for timers, schedulers, push channels and the
      vocabulary of bait, and asserts that only the repo and the seeder may write
      the table at all. Evidence: `evidence/phase5b/{commands.txt,feed-*.png}`,
      `server/repo/notifications.test.ts` (14) + `no-bait.test.ts` (11)
- [x] **North-star query verified on seeded events** — 4 people returned without
      logging in the week of 2026-08-03 (Dev, Lena, Maya, Sam), 0 in the weeks
      either side. The predicate is recomputed in the test by a second, dumber
      implementation over the raw events table and the two have to agree.
      Evidence: `evidence/phase5b/commands.txt`, `server/repo/northstar.test.ts` (6)
- [x] **Integrity tests: friends-only defaults, no persisted coordinates, no
      pay-for-rank** — a list posted `{visibility:"public"}` is stored `friends`;
      a log posted as public and attributed to somebody else is stored `friends`
      and owned by the poster; every route that takes a position is called with a
      coordinate nobody would produce by accident and **every table is swept: 0
      hits**; **135 columns, 0 that could hold a payment or a promotion**; and
      every write route in the product is handed a bribe (`sponsored`, `boost`,
      `rank`, `paid`, `priority`…) and Home's order is byte-identical afterwards.
      Evidence: `evidence/phase5b/commands.txt`, `server/repo/integrity.test.ts` (13)
- [x] a11y **0 serious/critical axe violations** across 5 surfaces × 2 viewports
      (10 reports, 19–25 passes each), headings run 1→2→3 with no jumps on every
      new surface, 44 px targets swept, `prefers-reduced-motion` leaves every
      computed animation/transition at 0 s, **no page scrolls sideways** (a new
      assertion, added because the first cut of the group roster did), anti-slop
      self-review done against the committed screenshots
- [x] Regressions: Phase 2 (24), Phase 3 (35), Phase 4 (42), Phase 5A (46) e2e
      suites re-run against the clean seed into their own subdirectories, plus
      the SPA boot smoke over 13 routes with zero console errors and every
      request on localhost

**Phase 5B decisions & assumptions (new — don't relitigate):**
- **Direction chosen by panel again, then judged.** Three independent directions
  for the three surfaces were generated against the real seeded data (the minutes
  of a meeting; one question at a time; the table itself), each rendered as
  working standalone mockups and screenshotted at 390 and 1280, then scored by
  three lenses (literal brief compliance / a sophomore in a queue / the designer
  who shipped the share page) and synthesised. Two of the panel's findings are
  in the product rather than in a document: the shared standing on a
  collaborative list, and the subtraction ledger.
- **Group mode is an intersection, and the ordering took three tries.** Coverage
  first answered with the place all four had been to and one of them ranks LAST
  of ten; the worst position first answered with one person's #2 that nobody else
  had heard of. What ships is a band, then coverage, then the worst position:
  first "is anybody putting up with this" — is it in the bottom half of any
  member's own list — then "how many of us actually want it". A member who has
  never been is **neutral, not a zero** (the distinction Phase 4 drew on Home),
  and both are printed, so a thin agreement cannot pass itself off as a thick one.
- **The arithmetic is on the page, and a need that costs nothing says so.**
  `ruled_out` is what each need costs *on its own*, which does not add up when two
  needs rule out the same places; `funnel()` charges each need only for what the
  ones before it left. "Wifi cost nothing tonight" is the most useful line on the
  surface, because it is the only way anybody learns which of their needs is cheap.
- **A session id is a link, so it is a token** — 12 random bytes, base64url, no
  clock in it, and the seeder refuses a readable one exactly as it refuses a
  readable share token. `/g/:token`, no shell, no auth check.
- **Sitting at a table is not a friendship.** Every signed-in seat must be an
  accepted friend of every OTHER signed-in seat, not merely of whoever started it
  — otherwise a host with two friends who do not know each other puts each of
  their rankings in front of the other. A by-link seat is anonymous: needs only,
  no ranked list, and it never reads a position. **The length of anybody's list
  never leaves the server**: "21st of 22" is a position and a denominator, and a
  denominator is the closest thing to a score this surface could print.
- **A tie is never broken and the numeral column is never invented into.** Two
  places the contributors ordered in opposite directions share one standing, the
  brace says which rows the numeral covers, and the column jumps from 3 to 5. A
  place no contributor has ranked gets **no numeral cell at all** — not a dash,
  not a zero; a placeholder in that column is one refactor from being a rank.
  Sorting them needed care: Copeland ties are broken by the pair itself, and a
  pairwise comparator that disagrees with itself around a cycle gives an order
  the language does not define, so tied groups are re-sorted on a LOCAL score.
- **A re-rank is an act, not a recomputation on read.** A list that quietly
  re-ordered itself would be a change nobody made, and there would be nobody to
  name in the notification the other editors get. `list_reranks` is its own table
  because it is the action record a `list_reranked` notification points at, and
  two re-ranks are two events. A re-rank that moves nothing is refused (409) and
  tells nobody.
- **`seed/lists.json` gains "still open when we are"** (Dev + Theo, six places,
  one of them Copper Kettle). Maya has ranked all 22 shops, so no list she can
  edit can ever reach the "added, not in the order" state — the design panel
  proposed trimming her ranking, which the seeder forbids (the hero must rank
  every shop for the Phase 2 gate). A second collaborative list is the fix that
  breaks nothing.
- **The notification feed lives at the top of your own page, and the shelf gains
  a number.** No fifth tab, no `/notices` route, no bell, no dot. This
  **supersedes** Phase 4's "no badges, because nothing here notifies you without a
  person behind it" rather than contradicting it: what makes a badge bait is that
  the product can raise it on its own. This one can be raised only by a friend
  request or a friend asking where to sit, is never raised by news, is never
  raised by elapsed time, and is lowered only by answering — where "not now" is
  an answer, which is why `needs_answer` is false once a row is read. Gold,
  because a count is a label; never ember, which has two jobs and this is neither.
  Nothing at all at zero.
- **`friend_logged` is cut from the schema's CHECK.** It is the one of the six
  that fires without anybody choosing to tell you anything — a feed of other
  people's activity, which is the shape the brief bans. The five that remain each
  point at a persisted action record, and the feed renders from THAT record: a
  request answered elsewhere reads as answered without the notification row being
  touched, and a record that is gone takes its sentence with it.
- **There is no `seed/notifications.json` and there must never be one.** All 31
  seeded rows are derived from action records already in the seed files — the
  friendships, the list editors, the group session's invitations. A hand-written
  notification would be the one row in the database that nobody did anything to
  cause.
- **The product says, in words, what it will not do — and the guard cuts those
  sentences out before scanning.** `no-bait.test.ts` caught Feed.tsx promising
  "there is no streak to keep, nothing to earn" and GroupSession.tsx promising
  "Cosign will not nudge anybody about it". The carve-out removes the exact
  promise text from the line and scans everything else, so a promise beside a real
  badge or a real `setInterval` buys neither any amnesty. `expectNoRatingScale`
  got the same treatment for "a vote is a rating with extra steps".
- **`src/components/ui/{badge,sidebar}.tsx` and `hooks/use-mobile` deleted.**
  Badge is the unread count this phase decided against; sidebar is a hamburger
  maze the brief bans and it ships a `SidebarMenuBadge` inside it. Same reasoning
  as Phase 1's slider and Phase 3's progress/radio-group/chart.
- **A table of people who have all been nowhere gets its own answer.** With no
  member having ranked anything, `picks` is empty and `unknownToAll` is not —
  and the empty-intersection copy ("nothing clears all of it") would have been a
  lie that sent four people home over a full campus. It says what is true instead:
  N places clear everything, none of you has been to any of them, and Cosign will
  not put them in an order it has no reason to believe.
- **The empty intersection is unit-tested rather than screenshotted**, because
  the seeded campus does have quiet places with outlets and wifi: four people
  asking for everything at once still get an answer, and the e2e records which
  branch the hour it ran produced (`group-strict-*.png`). `src/lib/group.test.ts`
  covers the empty branch and `costliestConstraint`'s tie-break directly.
- **Two pre-existing tests were timing out at Vitest's 5 s default** when the
  evidence script ran them beside a build and a server — both are Phase 4's
  unanimous-crowd-of-fifty tests against a real SQLite file. `testTimeout` is
  20 s now. Same lesson as the Lighthouse medians: a number that moves with load
  needs headroom, not a quieter machine.
- **Main JS bundle 400 kB → ~418 kB** with the three surfaces. Neither public
  page ships any of it.
- **Known gap, deliberately not closed:** the Wrapped-style semester recap stays
  reserved (logs still carry `semester` for it), and code-splitting is still
  unaddressed — it is on no acceptance criterion and the two public SSR pages
  load none of the bundle.

**What the review caught (fixed before commit — worth knowing, not repeating):**
- **The boot smoke was still aimed at a signed-off phase.** `scripts/boot-smoke.mjs`
  fell back to `evidence/phase1/` when `COSIGN_EVIDENCE_DIR` was unset, and a bare
  run of it during 5B rewrote twelve committed Phase 1 screenshots with Phase 5B's
  app. Third time this trap has been sprung (Phase 3 found `share.spec.ts`, Phase 4
  found `playwright.config.ts` and `e2e/fixtures.ts`); this was the last default
  pointing backwards. It is `evidence/scratch/spa/` now, and the artifacts were
  restored to the bytes Phase 1 was accepted on.
- **The suite was consuming a seeded fixture.** The feed tests used the seeded
  pending Lena → Maya request, and answering it CONSUMES it: the first run passed
  and the second found the state its own first run had created. They sign up their
  own asker now — the Phase 3 lesson, learned a third time.
- **Assertions were reading the DOM through the loading screen.** `[data-group]`
  and `[data-feed]` mark their own loading state, so a non-retrying
  `await locator.count()` found an empty page every time. Exactly the Phase 4
  `[data-home]` bug. `loaded(page, selector)` in `e2e/fixtures.ts` waits for
  `:not([data-state="loading"])`.
- **The first cut of the group roster made the page scroll sideways** — a person's
  needs are prose and they were in a `.cs-ledger`'s figure column, which is
  `white-space: nowrap`. A seat is two lines now, and the suite asserts no page in
  the phase overflows horizontally.
- **`.cs-word` still sets a minimum height and nothing about width**, so the
  list's "off" control was a 40 px target — the same finding Phase 4 recorded, on
  a new control. It has `min-w-[var(--tap)]` now.
- **A `.contents` wrapper breaks a CSS grid's `:nth-child`.** The ledger's
  hairlines and right-aligned figures target `:nth-child(even)`, and a `<div
  className="contents">` per row made every wrapper the child. Fragments.
- **The list could not tell "friends-only" from "cannot reach the server"** and
  said the first for both — the Phase 3 `PlaceFlow` defect and the Phase 4 Search
  defect, a third time. It gates on the response status now.
- **"a iced oat latte"** was on the share page, the public profile and the in-app
  profile for a phase and a half. One `article()` helper, three call sites.

---

## Resume protocol
1. `git -C <repo> status` — confirm branch `build/cosign`. If CLAUDE.md/PLAN.md are
   untracked, committing them **is** the remaining Phase 0 work.
2. Read CLAUDE.md gotchas; find the first unchecked box above.
3. Re-run the phase's verification commands before building on prior claims.
4. Update this file (checklist + evidence paths + any new assumption) in the same
   commit as the work it describes. If a phase stalls, commit the working subset and
   note the gap here. Ask the founder only when genuinely blocked; otherwise record
   the assumption here and proceed.

---

## Appendix: the brief (faithful summary — the only in-repo copy)

**Product:** social place-discovery for college students; places near campus,
cosigned by people you'd actually ask. Hero surface = public share page (one
person's ranked list as one link). Discovery-first; journaling is only the input
mechanic. GTM: one campus, saturated, before expansion.

**The 13 non-negotiables (FINAL — never relitigate):**
1. Moat = density + the share artifact, not features. Feature-led loses on arrival.
2. Share page ships before any settings/admin surface. No login wall, no install
   interstitial, ranked list first — not a map. Header: author as a person (name,
   photo, school, one-line taste summary); entries: photo + one honest line +
   intent tags; filter chips top; quiet "make your own" CTA bottom (to stub
   onboarding); designed OG image for iMessage/Instagram previews.
3. Head-to-head ranking only — never stars or any rating-scale input (sliders,
   1–10, thumbs). Places insert by binary search (better/worse taps vs midpoints,
   ≤ log₂(n)) into each person's ordered list — the shareable object.
4. Logging ≤ 10 s on a real phone: photo optional, structured taps only, one
   optional short line, no required free text; time-of-day auto-captured. Ranking
   runs after log save, outside the budget.
5. Intent tags (the differentiator): one tap on why you went — deep work, group
   project, reading, meeting someone, first date, quick grab, killing time between
   classes, late night, actually here for the coffee.
6. Functional place data: outlets (count + where), noise by time of day,
   camp-ability (4-hour stay), tested wifi speed, seating/table size, natural
   light, bathroom code, late hours, drip/latte price, student discount.
7. One-tap hero query on home: "near me, open now, has outlets."
8. Friend-weighted scores (friends outrank the crowd; baseline = aggregated rank
   from comparisons, never averaged ratings), group decision mode (intersection of
   4 people's needs), collaborative lists ("our ranking of campus coffee").
9. Google Maps saved-places import at signup (stub onboarding). Every empty state
   designed as carefully as home.
10. Freshness: show data age; prompt re-verify on revisit. Semester-aware UI (knows
    finals week); logs carry a semester field, reserving a Wrapped-style recap.
11. Notifications only from human actions (friend logged, friend asked, list
    updated) — never engagement bait. North star: weekly returning users who
    logged nothing.
12. Integrity: rank can never be bought. Privacy defaults: opt-in, friends-only,
    ephemeral, no persistent location history (location read momentarily, never
    stored). Reconciling with #2: a share link is the per-list opt-in — an unlisted
    tokenized public URL exposing only that list, revocable.
13. Cosign semantics: ranking a place into your list cosigns it; "cosigned by" =
    people whose ranked lists include it, friends first; no standalone cosign
    button in v1.

**Zero external services:** no account/key to demo — no paid APIs or free-tier
SaaS. Local SQLite/file persistence. Analytics: local events table (app_open,
log_created, share_viewed) behind an interface + tested north-star query. Maps and
geolocation behind provider interfaces with local stubs (fixed campus coordinate).
Auth v1 = dev user-switcher over seeded users (signed cookie) behind an
AuthProvider interface — no passwords/OAuth; signup = stub onboarding (pick/create
name + school). Share page and public profile NEVER require auth.

**Phase acceptance (beyond the checklists above):** P0 docs only · P1 one-command
seed, import round-trip, tests/typecheck pass, zero keys · P2 renders fully
logged-out, gate numbers in commit, every decision-2 element in mobile screenshots,
OG snapshot, tokens consumed · P3 ≤ 8 taps, no required keyboard, one decision per
step, screenshot per step, insertion unit-tested empty/head/middle/tail, no
rating-scale input anywhere · P4 hero query via stubbed geolocation,
friend-weighted ≠ crowd (tested), data-age from seed timestamps, re-verify on stale
revisit, mocked finals week visibly changes home · P5A profile URL logged-out + OG
+ perf gate, import maps fixtures onto places · P5B intersection-best for 4 seeded
users, collab list 2+ contributors re-ranks, no engagement-bait path, north-star
verified, integrity tests.

**Design direction (every UI phase):** invoke `frontend-design` + `ui-ux-pro-max`
first; warm editorial coffee-house with real personality; photography-forward;
editorial display type + clean body face; subtle purposeful motion. Anti-slop: no
default shadcn look, no purple-gradient-on-white-card, no Inter-everywhere.
Mobile-first, thumb-zone, ≤ 4 primary destinations, no hamburger mazes; WCAG
contrast, ≥ 44 px targets, prefers-reduced-motion. "Cosign" is the UI's endorsement
verb; copy voice: a knowing friend, not a brand.

**Data & seed:** 15–20+ realistic campus coffee shops (we pin 20+ so the gate's
20-place list exists) with full decision-6 + identity data; seeded users,
friendships, logs, comparisons, 3–5 ranked lists per user. All imagery committed
(CC0 or stylized placeholders, one warm treatment, plus per-log photos; no
hotlinking); no-photo fallback designed as first-class. Documented CSV/JSON import
format for the founder's seeding weekend; academic-calendar JSON; Takeout fixtures.

**Verification loop:** commit per acceptance criterion minimum; Playwright +
Lighthouse for web surfaces; screenshots 390×844 (share page also desktop);
axe-core or Lighthouse a11y ≥ 95 per surface + reduced-motion pass; anti-slop
self-review until nothing reads stock. Only functional criteria block commits,
never missing tooling (exception: the Phase 2/5A perf gate). Never claim done
without command output. Update PLAN.md per commit.
