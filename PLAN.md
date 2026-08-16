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

### Phase 4 — Home/discovery/shell ☐
- [ ] Hero query correct via stubbed geolocation (test)
- [ ] Friend-weighted ≠ crowd order (test); data-age labels; re-verify prompt
- [ ] Mocked finals week changes Home; shell + empty states in screenshots;
      a11y/reduced-motion/anti-slop pass

### Phase 5A — Profile + import ☐
- [ ] `/p/:token` logged-out + own OG + **hard perf gate** (numbers: ___)
- [ ] Takeout fixtures import in onboarding + empty states (test)

### Phase 5B — Social/notifications/metrics/integrity ☐
- [ ] Group intersection-best for 4 seeded users (test)
- [ ] Collab list with ≥ 2 contributors re-ranks (test)
- [ ] Notification feed human-action-only; no engagement-bait anywhere (audit)
- [ ] North-star query verified on seeded events (test)
- [ ] Integrity tests: friends-only defaults, no persisted coordinates, no
      pay-for-rank

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
