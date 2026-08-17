# CLAUDE.md — Cosign

Cosign is social place-discovery for college students: places near campus, cosigned by
the people you'd actually ask. The hero surface is the **public share page** (one
person's ranked list, sent as one link). The build brief, phase plan, decisions, and
current status live in **`PLAN.md`** — read it first; a fresh session should be able to
resume from it alone.

## Repo layout

```
<repo root>              ← docs (this file, PLAN.md), git root
└── cosign/
    └── cosign-app/      ← the entire app
        ├── src/         ← Vite + React SPA
        ├── server/      ← Hono + node:sqlite: JSON API, SSR share pages, static prod serving
        ├── seed/        ← the committed source of truth for all data + imagery
        ├── e2e/         ← Playwright specs + `fixtures.ts` (its own tsconfig project)
        └── scripts/     ← evidence capture (boot smoke, command transcripts)
```

The double nesting (`cosign/cosign-app`) is historical (the app was a nested repo,
flattened in commit 177368b). Do not move it — every path below is relative to
`cosign/cosign-app/` unless stated otherwise.

## Commands

All run from `cosign/cosign-app/`. **npm is canonical** (Node ≥ 24 required — the
persistence layer uses the built-in `node:sqlite`). The bun lockfiles are gone.

| Task | Command | Notes |
|---|---|---|
| Install | `npm install` | |
| Seed the database | `npm run seed` | one shot, from `seed/` → `server/data/cosign.db` |
| Dev servers | `npm run dev` | Vite 8080 + Hono 8787 (concurrently); Vite proxies `/api,/img,/u,/s,/p,/og` |
| Production | `npm run prod` | `vite build` then the server on 8787 serving `dist/` + SSR |
| Serve existing build | `npm run serve:prod` | skips the rebuild |
| Typecheck | `./node_modules/.bin/tsc -b` | project refs: app / node / server / **e2e** |
| Unit tests | `npm test` | Vitest, single run (~60 s cold / ~25 s of actual tests, 450 tests in 31 files) |
| Lint | `npm run lint` | ESLint flat config (5 pre-existing warnings, 0 errors) |
| Bulk shop entry | `npm run import:shops -- f.csv [--dry-run]` | merges by id into `seed/shops.json` |
| Shops → spreadsheet | `npm run export:shops -- f.csv` | round-trips back through import |
| Share-page e2e | `npx playwright test share.spec.ts` | 24 tests, mobile + desktop; needs the prod server up |
| Profile + import e2e | `COSIGN_EVIDENCE=phase5a npx playwright test profile.spec.ts` | 46 tests; the import half **writes** — point the server at a scratch DB first |
| Social/group e2e | `COSIGN_EVIDENCE=phase5b npx playwright test social.spec.ts` | 46 tests; **writes** (sessions, friend requests, re-ranks) — scratch DB first |
| Log-flow e2e | `COSIGN_EVIDENCE=phase3 npx playwright test log.spec.ts` | 36 tests; **writes** — point the server at a scratch DB first |
| Home/discovery e2e | `COSIGN_EVIDENCE=phase4 npx playwright test home.spec.ts` | 44 tests; **writes**; finals tests skip without `COSIGN_FINALS_BASE` |
| Perf gate | `MSYS_NO_PATHCONV=1 node scripts/lighthouse.mjs /s/<token> phase2 share` | exits non-zero if the gate misses; **name the phase** — it defaults to `scratch` |
| Phase 1 evidence | `bash scripts/phase1-evidence.sh` | needs the prod server up |
| Phase 2 evidence | `LH_RUNS=5 bash scripts/phase2-evidence.sh` | transcript + playwright + the gate |
| Phase 3 evidence | `bash scripts/phase3-evidence.sh` | owns its own server + scratch DB; :8787 must be free |
| Phase 4 evidence | `bash scripts/phase4-evidence.sh` | owns **two** servers (:8787 + :8788) and a scratch DB; both ports must be free |
| Phase 5A evidence | `bash scripts/phase5a-evidence.sh` | owns its own server + scratch DB; :8787 must be free; ~8 min (three Lighthouse gates) |
| Phase 5B evidence | `bash scripts/phase5b-evidence.sh` | owns its own server + scratch DB; :8787 must be free; no Lighthouse gate (5B ships no public SSR surface) |
| Phase 6 evidence | `bash scripts/phase6-evidence.sh` | the closing pass: every suite re-run as a regression + the gate and its font controls; owns its server + scratch DB; ~20 min |
| SPA boot smoke | `node scripts/boot-smoke.mjs` | `COSIGN_EVIDENCE_DIR=phase2/spa` to target a phase |

`COSIGN_EVIDENCE=<phase>` picks the directory Playwright writes into. It
defaults to `evidence/scratch/` (gitignored) — never to a phase that has been
signed off — so an ad-hoc `npx playwright test` cannot touch committed
evidence. Every evidence script sets it explicitly.

`COSIGN_CALENDAR=<file>` points the server at a different academic calendar
(default `seed/academic-calendar.json`). Configuration, not a test hook: it is
how `scripts/phase4-evidence.sh` stands a second server inside finals week,
and how a second school would be run.

`LH_BLOCK="*/fonts/*"` makes `scripts/lighthouse.mjs` block matching requests
in the browser. It is a measurement-side control and never a product hook: the
same build and the same server answer the same URL with one resource taken
away, so its cost can be priced against the budget instead of argued about. A
run that used it is marked `blocked` in the JSON and can never report a pass.

The Phase 2/5A Lighthouse gates run against `npm run prod` — **never**
`vite preview`, which bypasses SSR and measures the wrong thing.

`npx tsc` sometimes resolves to the unrelated `tsc` package on npm instead of
the local TypeScript; call `./node_modules/.bin/tsc` (or `.\node_modules\.bin\tsc.cmd`
in PowerShell) to be sure.

## Gotchas (verified on this machine, updated 2026-08-16 after the Phase 6 closing pass)

- **A default that points at a signed-off phase is a loaded gun, and this trap
  has now been sprung four times.** Phase 3 found `share.spec.ts`; Phase 4 found
  `playwright.config.ts` and `e2e/fixtures.ts`; Phase 5B found
  `scripts/boot-smoke.mjs`, whose bare run rewrote twelve committed Phase 1
  screenshots with Phase 5B's app — and 5B then wrote here that it was "the last
  one". It was not. The closing pass found `scripts/lighthouse.mjs` still
  defaulting to `phase2`, which meant **`npm run gate`** — a bare invocation of
  that script, and the one command in `package.json` named after the gate —
  overwrote Phase 2's committed numbers and its 500 kB report. All five default
  to `scratch` now. Do not write "that was the last one" again; instead check
  `git status evidence/` before committing, which is how every one of the four
  was caught.
- **The database file outlives the code that built it, and it is gitignored, so
  nobody's `git pull` brings it along.** Phase 5B added `list_reranks`; on a
  machine that had not re-seeded, `/lists/:id` answered a bare 500 (`no such
  table`) while every other route answered fine, and the SPA showed its "cannot
  reach the server" state — a schema problem wearing a network problem's
  clothes. `getDb()` now reads `schema.sql` and names the missing tables on
  startup. Re-seed after any schema change; stop the server first, the file is a
  lock.
- **A module that runs its CLI at import time cannot be tested.**
  `server/import/cli.ts` called `die()` on `process.argv` at the top level, so
  importing `mergeShop` from it killed the whole vitest file with "process.exit
  unexpectedly called with 1". Same rule, same fix as `server/index.ts` and its
  `serve()`: guard on `import.meta.url === pathToFileURL(process.argv[1]).href`.
- **A surface marks its own loading state with its own attribute**, so
  `[data-group]`, `[data-feed]`, `[data-list]` and `[data-home]` are all on
  screen before there is anything on them. Playwright's `expect()` retries and
  hides this; a bare `await locator.count()` or `innerText()` does not, and
  finds the loading screen every time. Use `loaded(page, "[data-x]")` from
  `e2e/fixtures.ts`, which waits for `:not([data-state="loading"])`.
- **An e2e that answers something CONSUMES it — including for the OTHER
  project.** `workers: 1` runs mobile then desktop against one database, so a
  fixture the mobile run answers is gone by the time desktop reaches the same
  test. Phase 5B hit this twice: the seeded pending friend request (Lena →
  Maya) made the feed tests pass on the first run and fail on the second, and
  the re-rank test's own fixture was consumed across projects. Anything a test
  *answers* — a friend request, a group invite, a re-verify prompt, an
  out-of-date list — must be created by that test, and keyed on
  `test.info().project.name` if the two projects would fight over it.
  `signInAsNewUser` and `askedBySomebodyNew` in `e2e/social.spec.ts` are the
  pattern.
- **An evidence script that writes must not write to the database it is about
  to photograph.** `phase5b-evidence.sh`'s transcript re-ranked both
  collaborative lists before Playwright started, so the "before" and "after"
  screenshots were the same file and the assertion behind them sat inside an
  `if` that was false. The demos have their own `$DEMO` database now.
- **`kill $!` on `npm run …` kills the wrapper and returns 0.** Four phases of
  evidence scripts claimed to clean up after themselves and left a node
  process holding :8787 — which the next run's preflight catches loudly, but
  an ad-hoc `npx playwright test` silently measures the stale server. Kill by
  port (`Get-NetTCPConnection -LocalPort 8787 -State Listen`).
- **`lastIndexOf("/*")` on a raw line finds the one inside `"/img/*"`.** The
  no-bait scanner opened a block comment that never closed and skipped 13.5%
  of the tree, including 282 of `schema.sql`'s 285 lines. Any source scanner
  here must strip string literals and line comments (`//` and `--`) first.
- **Two surfaces added in Phase 5B leaked what the brief says they never do,
  and both are worth knowing as a shape.** `GET /api/lists/:id` computed the
  merged order from every contributor's ranking — which is correct — and then
  let *what the order was computed from* travel with it, so a caller who could
  read the LIST could read positions out of rankings they had no right to. And
  `sessionView` published each seat's `participant_token`, which is that seat's
  only write credential, to every reader of a public link. The shape both
  times: a value the server legitimately needs internally, shipped because it
  was already in the object. `derivedOrderFor` and the opaque seat id are the
  fixes; `integrity.test.ts` asserts both.
- **`.cs-ledger` is for counts, not for prose.** Its value column is
  `white-space: nowrap`, so a sentence in it makes the whole page scroll
  sideways. `e2e/social.spec.ts` asserts no page in the phase overflows
  horizontally; a person's needs are two lines, not a ledger row.
- **A `<div className="contents">` wrapper breaks `:nth-child` in a grid.**
  `.cs-ledger` styles its hairlines and right-aligned figures with
  `:nth-child(even)`; wrapping each `dt`/`dd` pair makes the wrapper the child
  and the rule matches nothing. Use a `<Fragment key>`.
- **Vitest's 5 s default is not enough beside a build and a server.** Phase 4's
  two unanimous-crowd-of-fifty tests run in 1–3 s idle and time out inside
  `phase5b-evidence.sh`, which reported a red suite for a machine-load
  artifact. `vitest.config.ts` sets `testTimeout: 20_000`.
- **`.cs-word` still sets a minimum HEIGHT and nothing about width.** Phase 4
  recorded this and Phase 5B hit it again on a new control ("off" at 11 px is
  40 px wide). Any short word used as a target needs `min-w-[var(--tap)]`.

## Older gotchas (Phase 5A)

- **The Lighthouse LCP number depends on which side of the first paint the fonts
  land on, and on localhost that is a coin flip.** Lantern's pessimistic graph
  charges FCP for every font request that *completed before the observed paint*.
  The fonts are served from :8787 in about a millisecond, so a page whose first
  paint is TEXT usually loses the race and pays ~450 ms of simulated LCP for a
  font its text never waits on (`font-display: swap`). Proof, from one
  `phase5a-evidence.sh` run: the profile measured 1280 ms and the **share page**
  — which passes at 763 ms — produced a 1433 ms outlier on the one run where
  *its* fonts landed first. Before optimising a page against this number, run
  the share page as a control in the same minute and read `observedFirstContentfulPaint`
  against the last font's `networkEndTime` in the `.report.json`.
  **Phase 6 priced it.** Run the profile again with `LH_BLOCK="*/fonts/*"` and it
  measures 947 ms with the fonts gone entirely — that is the floor, and it leaves
  53 ms of the 1000 ms budget, while the fonts cost ~335 ms. Meanwhile the share
  page, unchanged since Phase 2, measured 869 · 911 · 1010 · 833 · 974 ms across
  five sessions; the 1010 was taken with 22 stray Chrome processes still running from a
  previous gate run, so **kill leftover chrome before measuring anything**. Note
  the control is a floor on the profile and NOT on the share page, where blocking
  the fonts came out *slower* (fallback metrics move the LCP element). Do
  not spend a day optimising either page against this gate; read PLAN.md's Phase
  5A perf section first.
- **Inline SVG is expensive in a way an `<img>` is not.** The profile's map is
  forty-odd nodes; inline it cost **737 ms of throttled style+layout** against
  218 ms for the same page without it. It is served as a `data:image/svg+xml`
  URI instead. If you do that, the SVG is a *separate document with no `:root`*
  — every `hsl(var(--token))` must be substituted for a literal
  (`profileMapSvg(model, { literal: true })`), because an unresolved `var()`
  draws nothing at all and a mark that silently vanishes from a map is worse
  than a wrong one.
- **HTML positioned over a scaling drawing does not scale with it.** The plate is
  `aspect-ratio`-sized from ~354 to 512 px while its labels stay at a fixed 11 px.
  A box sized in SVG user units is therefore too small for its text at one end and
  hollow at the other — the imprint's border is a CSS border on the label, and the
  scale bar that used to sit inside it was struck through its own caption before
  it was removed. Anything drawn *near* HTML text needs clearance measured at the
  narrow end.
- **`/tmp` is two different directories.** Under Git Bash `curl -o /tmp/x` writes
  to `C:\Users\<you>\AppData\Local\Temp\x`; `node` reads `/tmp/x` as `C:\tmp\x`.
  An evidence script that hands a path from one to the other silently splits them.
  Use a relative path (`./thing.tmp.html`) when both tools touch the same file.
- **A `\b` in a regex does not survive a heredoc into a `python -` or `node -e`
  one-liner** — it arrives as a literal backspace (0x08) and the regex then
  matches nothing while still *looking* right in a diff. Prefer the Write/Edit
  tools for source, and if you must patch programmatically, assert afterwards
  that the guard can still fail.

## Older gotchas (Phase 4)

- **A default that points at a signed-off phase is a loaded gun.** Phase 3
  fixed `share.spec.ts`'s hard-coded `evidence/phase2/`, but the *fallbacks*
  still pointed backwards: `playwright.config.ts` defaulted to `phase2` and
  `e2e/fixtures.ts` to `phase3`, so a bare `npx playwright test home.spec.ts`
  wrote Phase 4 screenshots into `evidence/phase3/` and overwrote Phase 2's
  committed results JSON. Both default to `evidence/scratch/` now. Still check
  `git status evidence/` before committing a phase.
- **A `fullPage` screenshot of a sticky element is a capture artifact, not the
  design.** `.cs-shelf` is `position: sticky; bottom: 0`; a full-page capture
  lands it wherever the scroll happened to be, i.e. across the middle of a
  row. Use `shotViewport()` (e2e/fixtures.ts) for anything shell-bearing, and
  scroll to the bottom before a full-column `shot()`. And wait for the page to
  *render* before measuring its height — scrolling a loading screen to its
  "bottom" is a no-op, which is how the artifact got committed once already.
- **The evidence suites share one scratch database, so their ORDER is part of
  the evidence.** `log.spec.ts` drives the real log flow as `u_lena` and grows
  her ranking; run it before the Phase 4 suite and Home's screenshots show
  "your second" against a place she has never been. `scripts/phase4-evidence.sh`
  runs share (read-only) → home → log (writes most, builds its own fixtures).
- **`minutesUntilClose` must join overlapping windows, not just midnight
  ones.** The All-Nighter is 07:00–01:00 Mon–Wed and 00:00–24:00 Thu–Sun: on a
  Wednesday afternoon those two overlap and it is open for 106 hours. An
  exact-midnight-only join reported eleven, which quietly handed the
  finals-week hero to a place that shuts at 8pm.
- **axe reports a contrast failure it cannot measure as "incomplete", which
  never fails a gate.** The fact separators were `--rule-strong` on the page
  ground — 1.68:1 — for a whole phase, and twelve green axe reports said
  nothing. If a colour is on *text*, check it against `tokens.md` by hand;
  `--rule` and `--rule-strong` are hairline colours and are documented as
  "decorative only — never text".
- **react-query's default is three retries with exponential backoff**, i.e.
  seven seconds of "Looking…" before any screen may say it cannot reach the
  server. `App.tsx` sets `retry: 1, retryDelay: 500`. If a designed failure
  state seems not to render in a test, check that first.
- **Gate a screen on the DATA, never on `isLoading` or `isError`.** A query
  paused because the browser went offline is neither. Phase 3 learned this on
  `PlaceFlow`; Phase 4 shipped the same bug on Search and the review caught
  it. The pattern is `const unreachable = !query.isLoading && !query.data;`.

## Older gotchas (Phase 3)

- **A phase's evidence run must never be able to rewrite an earlier phase's.**
  `share.spec.ts` hard-coded `evidence/phase2/`, so Phase 3's regression re-run
  silently regenerated seven committed Phase 2 artifacts from a database its own
  log suite had filled with test accounts — the OG image's cosign count moved and
  a designed empty state vanished from the screenshot Phase 2 was signed off on.
  Every spec now derives its directory from `COSIGN_EVIDENCE`, and a regression
  re-run happens **before** the writing suite and into its own subdirectory.
  Check `git status evidence/` before committing a phase.
- **The log-flow e2e writes, so never point it at `server/data/cosign.db`.**
  `scripts/phase3-evidence.sh` seeds a scratch DB (`COSIGN_DB=…`), builds, serves
  against it, runs the suite and stops. Run the specs against the real database
  and the second run finds state its own first run created. Tests that need an
  empty ranking sign up a **fresh account** through `POST /api/auth/create` rather
  than reusing `u_noah`, for the same reason.
- **axe measured mid-animation reports contrast failures that do not exist.**
  Each step fades in over 200 ms; axe sampled `#817364` (muted at partial opacity)
  and failed it at 4.08:1, when the resting `#9A8977` is 5.5:1. `await settled(page)`
  in `e2e/fixtures.ts` awaits `document.getAnimations()` before auditing or
  screenshotting. If a contrast number looks impossible, check the fill state first.
- **`server/index.ts` only calls `serve()` when it is the entry module.** It used
  to bind at import time, so `import { app }` in a test hit the EADDRINUSE guard
  and killed the whole vitest run. The npm scripts are unaffected — but if you ever
  add a new entry point, it must call `serve()` itself.
- **Timed runs need the CDP session, not `page.emulate*`.** The ≤ 10 s budget is
  measured with `Emulation.setCPUThrottlingRate: 4` plus
  `Network.emulateNetworkConditions` (150 ms RTT, 1.6 Mbps), median of three runs;
  a single run swings ±700 ms. It is mobile-project-only by design.
- **The optional log photo has a local upload route** (`POST /api/uploads` →
  `server/data/uploads/`, served at `/u/*`). It sniffs magic bytes, caps at 2 MB
  decoded, and generates its own filename — never trust the client's. `logs.photo`
  is allowlisted to the seeded `/img/logs/log-NNN.svg` or an uploaded `/u/*` path.
  This is the only writable surface outside the DB; keep it that way.

## Older gotchas (Phase 2)

- **Only one process may own :8787 — and it now says so.** `server/index.ts`
  exits 1 with a clear message on `EADDRINUSE`. Before that guard existed, a
  second `npm run prod` died quietly while the *stale* server kept answering,
  and every check afterwards silently measured the previous build. If a result
  looks impossible, check the listener's start time first
  (`Get-NetTCPConnection -LocalPort 8787 -State Listen`).
- **Git Bash rewrites leading-slash arguments into Windows paths.** Passing
  `/s/<token>` to a node script becomes `C:/Program Files/Git/s/<token>`; the
  Lighthouse failure surfaces far away as `INVALID_URL`. Prefix with
  `MSYS_NO_PATHCONV=1` (`scripts/lighthouse.mjs` also rejects a path that does
  not start with `/`, with that hint).
- **Lighthouse numbers move with machine load.** Simulated throttling makes the
  network deterministic but scales *observed* CPU by 4×, so a busy box inflates
  LCP — roughly one run in five lands ~500 ms high. Always take the median
  (`LH_RUNS=5`), and stop the design-lab/dev servers first.
- **The seeded imagery's grain filter is expensive.** Every SVG ends with a
  full-frame `feTurbulence` pass rasterised over its 800×600 user-space region
  no matter how small it is drawn. On the LCP element that was ~110 ms of
  render delay and the whole source of run-to-run variance;
  `inlineSvg(path, { grain: false })` strips it for the inlined hero only.
  Anything that becomes an LCP element in a later phase should do the same.
- **`chrome-launcher` throws `EPERM` cleaning its temp profile on Windows.**
  It happens *after* the measurement, so `scripts/lighthouse.mjs` catches it —
  never let it fail the gate, it looks exactly like a perf regression.
- **Fonts are committed files, not a dependency.** `public/fonts/*.woff2` (the
  browser) and `server/assets/fonts/*.woff` (satori, which cannot parse woff2)
  were extracted once from `@fontsource/*` and committed with their OFL
  licences. Those packages are not in `package.json`; do not add them, and do
  not add a font the token file does not name — `tokens.test.ts` fails on both.
- **resvg cannot read our `.woff` files**, so anything still live as *text*
  inside a nested SVG is dropped from the OG image. satori converts its own
  text to paths, so the fix is to compose in satori rather than to hand resvg a
  font (see `avatarEl` in `server/pages/og.ts`).

## Older gotchas (Phase 1)

- **The app boots and runs entirely locally now.** Supabase/Google/Vercel/Lovable are
  gone; `server/` (Hono + `node:sqlite`) owns the data. Run `npm run seed` once, then
  `npm run dev` or `npm run prod`. Never re-introduce a `.env`, a key, or a remote
  host — the brief mandates zero external services, forever.
- **The DB is a file lock.** `server/data/cosign.db` cannot be deleted or re-seeded
  while a server holds it (Windows gives `EPERM`/`Device or resource busy`). Stop the
  server first, or seed elsewhere with `COSIGN_DB=/tmp/x.db npm run seed`.
- **Only one process may own :8787.** A second `npm run prod` dies with the port
  already bound and *looks* like it started. If a check hits a stale instance, free
  the port first (`Get-NetTCPConnection -LocalPort 8787`).
- Vitest is fast again (~8 s for 49 tests) — the slow jsdom default is bypassed by
  `// @vitest-environment node` at the top of pure-logic and server test files. Keep
  using that pragma; a jsdom-env test file costs ~1 min of startup.
- **Playwright: browsers are installed** (chromium v1217). `playwright.config.ts`
  runs `e2e/` against the prod server in two projects (mobile 390×844, desktop
  1280) and writes screenshots, axe reports and the OG snapshot into
  `evidence/$COSIGN_EVIDENCE`, which defaults to `scratch` — it said `phase2`
  here for four phases, and that was a loaded gun (see the top of this file).
  `scripts/boot-smoke.mjs` still drives chromium directly.
- **Windows dev machine.** Paths contain a space (`Vineet Sista`) — always quote.
  Git Bash is available for POSIX scripts; PowerShell 5.1 is the primary shell.
- **330 kB main JS chunk** after build, 100 kB gzipped (446 kB before the Phase 6
  closing pass, which deleted two toast systems and a tooltip provider that
  `App.tsx` mounted and nothing used — 116 kB, a quarter of the bundle, for three
  things no screen rendered; 400 kB before Phase 5B; 382 kB before Phase 4; 345 kB
  before Phase 3's two pages; 672 kB before the external SDKs left).
  Code-splitting is still unaddressed; the share page must not ship this bundle at
  all — `e2e/share.spec.ts` asserts it requests zero `/assets/*.js` and zero
  stylesheets.
- `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`). Match
  existing style; don't fight it mid-phase.

## Hard rules (from the brief — never relitigate)

- **Zero external services.** Local SQLite (`node:sqlite`) / file persistence only.
  No API keys, no CDNs (fonts included — self-host), no remote backend. Maps/geo/auth
  behind provider interfaces with local stubs (fixed campus coordinate).
- **No rating-scale inputs anywhere** — no stars, sliders, 1–10, numeric scales, or
  thumbs. Ranking input is head-to-head comparison only (binary-search insertion into
  the user's ordered list). Qualitative place data (noise etc.) uses labeled enum
  taps (e.g. `quiet / conversational / loud`), never numbers. **This is enforced,
  not remembered:** `src/design/no-scales.test.ts` fails the unit suite on a
  range/number input, `role=slider|progressbar|radiogroup`, `aria-value*`, a
  star/thumb glyph, an `N/5` score, or an import of a scale-capable primitive
  anywhere under `src/` or `server/`. Don't weaken it — and don't reach for a
  progress bar as a step indicator; the log flow shows progress as a sentence.
- **Share page and public profile never require auth**, are SSR/SSG with minimal JS,
  and are addressed by revocable tokens.
- **Cosign only via ranking.** Ranking a place into your list *is* the cosign;
  "cosigned by" = people whose ranked lists include it, friends first. No standalone
  cosign/endorse button in v1.
- **Rank can never be bought** — no paid-placement path of any kind.
- **Friends-only by default.** Lists/logs/rankings default to friends visibility;
  public exposure happens only through an explicit, revocable per-list/profile share
  token.
- **Notifications only from human actions.** No engagement bait anywhere — no
  streaks, badges, or scheduled nudges. Analytics is a local events table.
- No persistent location history; location is read momentarily and never stored.

## Conventions

- Path alias `@/` → `src/`. shadcn/ui primitives in `src/components/ui/` (do not
  hand-edit generated primitives; `components.json` configures the CLI).
- **`src/design/tokens.css` is the canonical design system** — colour, type,
  space, radius, motion, in one file, read by `tailwind.config.ts`,
  `src/index.css`, and `server/pages/tokens.ts` (which inlines it into the SSR
  pages, since a stylesheet request would cost a round trip the LCP budget
  cannot afford). Every colour is a bare `H S% L%` triple so `hsl(var(--x))` and
  Tailwind's `/ <alpha-value>` both work. Rationale in `tokens.md`, enforcement
  in `tokens.test.ts`. **Do not re-decide aesthetics ad hoc, and do not define a
  colour anywhere else** — the one unavoidable duplication lives in
  `server/pages/tokenHex.ts` (satori and an SVG inside an `<img>` both lack CSS
  custom properties), and `tokens.test.ts` guards it *and* fails on a literal hex
  appearing anywhere else under `server/pages/`. Six more hand-written copies of
  the ground exist where no stylesheet can reach — `index.html`, `manifest.json`
  twice (`theme_color` and `background_color`), and a `<meta name="theme-color">`
  on each of `shareList`'s page **and** its tombstone plus `shareProfile`'s — and
  the same test guards all of them.
- **Phase 5B added exactly two shapes and no person-shape.** `.cs-ledger` (a
  two-column hairline table of counts that subtracts to an answer — the group
  page's "how 22 became 6", the shared list's "who keeps it") and `.cs-brace`
  (the bracket joining two entries that share one standing). A person is
  `.cs-caps` in `--line` plus a value in `--muted`, which the vocabulary
  already draws; **no avatar or monogram appears on any 5B surface**, because
  those pages put three to six people on one page and a column of monograms is
  an avatar row by another name. A solid ember chip is permitted **only** where
  the field is single-select, and there is one solid `.cs-pill` per page.
- **There are two public SSR surfaces and they share a vocabulary, not a template.**
  `server/pages/shareList.ts` is one person's ranked list at `/s/:token`;
  `server/pages/shareProfile.ts` is who that person is about coffee at `/p/:token`,
  with `profileMap.ts` (pure geometry) and `profileData.ts` behind it. Same reading
  column, same tokens, same `escapeHtml`/`smart`, same tombstone
  (`renderTombstone(kind)`). A token opens exactly one of them; the other 404s.
- **The SPA's design vocabulary is the `cs-*` layer in `src/index.css`** (Phase 3,
  extended in Phase 4): `.cs-wrap` (the reading column), `.cs-caps` (the small-caps
  voice), `.cs-display` / `.cs-figures`, `.cs-row` (a hairline row whose press state
  bleeds through the gutter, and whose `aria-pressed` state draws the 2 px ember
  mark in the margin), `.cs-shot` / `.cs-plate` (photo or the designed no-photo
  plate), `.cs-pill` / `.cs-pill-ghost`, `.cs-word` (a 44 px-tall word like BACK —
  it sets no minimum *width*, so give a short one its own padding), `.cs-stamp`,
  `.cs-chip` (a filter chip, ported from the share page), and `.cs-shelf` /
  `.cs-tab` / `.cs-tab-log` (the four-word bottom shell). Later phases port this
  rather than inventing a second look — `src/pages/LogFlow.tsx`, `PlaceFlow.tsx`,
  `Home.tsx` and `ShopDetail.tsx` are the reference implementations, and
  `src/components/Nothing.tsx` is how every empty state is set. No cards, no radius
  above 3 px except the two pills, no icons on these surfaces (lucide is gone from
  everything outside `src/components/ui/`).
- **Ember has two jobs and gold has one.** Ember: the order (rank numerals, the
  active tab's rule, the selection mark) and the act of writing (`SAVE IT`, the
  `Log` tab). Gold: the label voice. They never do each other's job, and neither
  is ever a background for a large area.
- Data fetching via `@tanstack/react-query` (the log flow prefetches `shops` /
  `meta` / `ranking` on the entry pill's `pointerdown`, which is why the measured
  path makes exactly one request — the save). Motion via CSS on the duration
  tokens; **avoid `framer-motion` on new surfaces** — `whileTap`, springs and
  `layoutId` ignore `prefers-reduced-motion`, which is a phase gate. The package
  is still a dependency but nothing under `src/` imports it. Tailwind's own
  `animate-*` utilities are the same trap for the same reason: `animate-spin` is
  `spin 1s linear infinite` and no reduced-motion block reaches it.
- Domain types in `src/types/cosign.ts`; pure domain logic in `src/lib/` —
  `calendar.ts` (terms and finals week, replacing Phase 0's placeholder
  `semester.ts`), `timeBucket.ts`, `freshness.ts`, `geo.ts`, `discover.ts`,
  `insertion.ts`, `logFlow.ts`, `palette.ts`, `placeCopy.ts`, `collab.ts`,
  `group.ts`, `title.ts`. None imports a node built-in, because the server
  imports them too — `server/repo/lists.ts` imports `collab.ts` and
  `server/repo/group.ts` imports `group.ts`, which is the whole reason for the
  rule. All are unit-tested except `title.ts`, which is checked behaviourally
  instead: `scripts/boot-smoke.mjs` reads `document.title` off each running
  route, because what it has to get right is what the tab actually says.
- **The document title is a route's job, not `index.html`'s** (`src/lib/title.ts`).
  Every page calls `useTitle(...)`, passing `null` while the name is still in
  flight — a tab that still says the last shop you opened is worse than one that
  says nothing. `scripts/boot-smoke.mjs` reads `document.title` off each running
  route and fails if they all agree.
- Copy voice: a knowing friend, not a brand. "Cosign" is the endorsement verb.

## Evidence tooling (Phase 0 decision)

Web-only product → **Playwright** for screenshots (mobile viewport **390×844**; share
page also desktop) and flows, **Lighthouse** (mobile, Slow-4G) for the Phase 2/5A perf
gates. Required for every UI phase: axe-core or Lighthouse a11y ≥ 95 per surface, a
`prefers-reduced-motion` pass, and an anti-slop self-review of screenshots (no default
shadcn look, no purple-gradient-on-white-card slop, no Inter-everywhere — the
`stop-slop` skill helps). No native surface exists, so no Expo/Maestro/simulator
mechanism is needed. Evidence artifacts are committed under `evidence/<phase>/` at the
repo root; every acceptance criterion gets command output, not claims.
