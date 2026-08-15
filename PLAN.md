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
  shell; persists comparisons + updated ranking_entries).
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

### Phase 1 — Domain, seed, rename ☐
- [ ] Scoped rename commit (residual sip refs only); build + tsc green (evidence in
      commit message)
- [ ] De-service/cleanup commits; build + tsc green after each
- [ ] Schema + repos + one-shot `npm run seed`; `npm run prod` works
- [ ] CSV/JSON import round-trips via exporter (unit test)
- [ ] SPA boots against local API (incl. stub-signup onboarding); typecheck + tests
      pass; zero keys anywhere (evidence: `evidence/phase1/`)

### Phase 2 — Share page, OG, tokens ☐
- [ ] Tokens file committed via design skills; consumed by Tailwind
- [ ] Share page SSR, logged-out; **all decision-2 elements** (header
      name/photo/school/taste-line; per-entry photo+line+tags; chips top; CTA
      bottom; no-photo fallback; cosigned-by friends-first) visible in mobile
      screenshots
- [ ] OG snapshot committed with author name+photo, list title, top places, cosign
      count
- [ ] Token revocation works (test)
- [ ] a11y ≥ 95 + reduced-motion pass + anti-slop self-review
- [ ] **Perf gate: LCP ≤ 1.0 s, score ≥ 90** (numbers: ___ ; evidence:
      `evidence/phase2/lighthouse.json`)

### Phase 3 — Logging + ranking ☐
- [ ] ≤ 8 taps, zero required keyboard input, ≤ 10 s timed (Playwright), per-step
      shots
- [ ] Insertion unit tests: empty/head/middle/tail; insertion runs only after log
      save
- [ ] time_bucket + semester auto-captured; no rating-scale input anywhere (sweep)

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
