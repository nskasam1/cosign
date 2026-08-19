# CLAUDE.md — Cosign

Cosign is social place-discovery for college students: places near campus, cosigned by
the people you'd actually ask. The hero surface is the **public share page** (one
person's ranked list, sent as one link). The build brief, phase plan, decisions, and
current status live in **`PLAN.md`** — read it first; a fresh session should be able to
resume from it alone.

## Repo layout

```
<repo root>              ← docs (this file, PLAN.md, DEPLOY.md), git root
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
| Unit tests | `npm test` | Vitest, single run (~25 s, 464 tests in 32 files — it halved when the shadcn tree left the module graph) |
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
| Phase 7 evidence | `bash scripts/phase7-evidence.sh` | the motion pass: the guard, the hairlines, every suite re-run, the gate as a regression; owns its server + scratch DB; ~20 min |
| Post-commit verify | `PORT=8791 bash scripts/postcommit-verify.sh` | not a phase's evidence: writes to `evidence/scratch/`; owns its server + scratch DB; runs home/social **only when the campus is open** |
| Phase 9 evidence | `PORT=8791 bash scripts/phase9-evidence.sh` | passkeys: owns **two** servers (:8791 permissive, :8792 strict) + scratch DB; both ports free |
| Passkey e2e | `COSIGN_EVIDENCE=phase9 npx playwright test passkey.spec.ts` | 22 tests; **writes**; the 4 strict ones skip without `COSIGN_STRICT_BASE` |
| Perf gate + a11y probe | `PORT=8791 bash scripts/gate-and-a11y.sh` | the restated criterion on both public pages, then the accessibility checks axe cannot make; owns its server + scratch DB |
| A11y probe alone | `COSIGN_BASE=http://localhost:8791 node scripts/a11y-probe.mjs` | tab order, focus indicators, names, live regions, focus on route/step change |
| Price font subsetting | `node scripts/subset-fonts.mjs` | report only; needs `pip install --user fonttools brotli`. `--write` exists and is deliberately unused |
| Gate, measured 3 ways | `PORT=8791 bash scripts/gate-experiment.sh` | simulate vs devtools vs cpu, both public pages — the experiment behind the restated criterion |
| Prove the focus test bites | `PORT=8791 bash scripts/prove-route-focus.sh` | removes `<RouteFocus />`, rebuilds, expects red, restores |
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

## Gotchas (verified on this machine, updated 2026-08-18 after Phase 9)

- **`POST /api/auth/switch` is OFF in production, and the e2e suites depend on
  it.** It takes a user id and no credential and returns that person's session.
  It now needs `COSIGN_DEV_AUTH=1` or a non-production `NODE_ENV`, and so does
  `GET /api/auth/users`. **Every script that stands a server must export
  `COSIGN_DEV_AUTH=1`** or all 196 pre-Phase-9 e2e tests fail at sign-in —
  `postcommit-verify.sh`, `gate-and-a11y.sh`, `gate-experiment.sh`,
  `prove-route-focus.sh` and the permissive half of `phase9-evidence.sh` all do.
  Passkeys are always on; they are the credential a real person uses.
- **`COSIGN_RP_ID` is a registrable domain and it is irreversible.**
  `cosign.example`, never `https://cosign.example`, never with a port. A passkey
  is bound to it inside a credential stored on somebody else's phone: change it
  and every passkey ever registered stops working, with no migration path. If
  both apex and `www` are served, set the RP id to the apex and put both in
  `COSIGN_ORIGINS`. See `DEPLOY.md`.
- **WebAuthn needs a secure context, so passkeys are absent over LAN HTTP.**
  They work on `https://` and on `http://localhost` and nowhere else. Testing on
  a phone at `http://192.168.x.x` will show no sign-in button at all — that is
  `isSecureContext` in `src/lib/passkey.ts` refusing to render a control that
  would throw, not a bug.
- **An e2e must never import `src/lib/*` into the page.** The first passkey spec
  did `await import("/src/lib/passkey.ts")` inside `page.evaluate`, which works
  only under `npm run dev` where Vite serves the source. Against the production
  build — the mode every suite actually runs in — there is no such URL. Drive
  the UI or the HTTP API.
- **`page.evaluate` that returns a promise blocks the test.** Capturing a
  request by resolving a promise from inside `evaluate`, then awaiting it before
  the click that triggers the request, hangs for the full 30 s timeout. Install
  the hook in an evaluate that returns immediately, stash the value on `window`,
  click, then `expect.poll`.
- **The seeding worksheet refuses to import on purpose.**
  `seed/scouting/high-street-worksheet.csv` leaves `natural_light` and `camp_ok`
  blank, and `parseShopsCsv` requires literal `true`/`false` — so
  `npm run import:shops -- … --dry-run` names the row and column that still
  needs somebody who was in the room. Do not "fix" it by filling those in.

## Older gotchas (Phase 8)

- **The perf gate no longer decides on LCP, and the reason is three
  measurements rather than an argument.** `simulated LCP <= 1.0 s, median of
  five` is gone; the gate is now `perf >= 90`, `a11y >= 95`, and the simulated
  LCP as a **tripwire at 1.5 s**, with the real protection being the
  deterministic page-weight assertions in `share.spec.ts`/`profile.spec.ts`.
  `/p/` cannot reach 1.0 s (947 ms is its floor with the fonts blocked
  entirely); `/s/` passes it about half the time on unchanged bytes (eleven
  medians, 745–1143 ms); and **both attempts to measure it better came out
  worse** — `LH_METHOD=devtools` ranged 1062–3421 ms and reversed which page
  looks faster, `LH_METHOD=cpu` spread 813 ms and 2702 ms against ~310 ms for
  `simulate`. Both survive as diagnostics that can never report a pass. Every
  results JSON still carries `legacyPassed` against the old 1.0 s bar, so this
  is auditable and reverses in one line of `GATE`.
- **Font subsetting is worth 6.9 kB, not 21, and is rejected anyway.**
  `scripts/subset-fonts.mjs` prices it: 52.2 -> 45.3 kB, ~44 ms. PLAN's earlier
  "~110 ms" was 2.5x optimistic because `public/fonts/*.woff2` were extracted
  from `@fontsource` *already Latin-subset* — 227 mapped codepoints, not the
  ~700 of a full face. What the 6.9 kB would drop includes **U+2018**, five
  combining accents, the euro sign and the bullet. `smart()` only ever emits
  U+2019, so scanning the tree does not see U+2018 — but a phone's own smart
  quotes do, and these are public pages carrying text a person typed. Don't.
- **`stop_server` must not return before the port is free, and now doesn't.**
  `powershell -NoProfile` takes ~1 s to start. If the trap returns first, the
  next script in the same shell can seed, build and stand its own server on
  that port inside the window — and the kill lands on the NEW server. This
  happened twice in one evening: seven `social.spec` tests failed with
  `ECONNREFUSED` and read exactly like a code regression, and a gate run
  reported "stopped answering" about a server whose own log showed a clean
  start and no error. If a suite fails with connection-refused, check for an
  overlapping run before you read the diff.
- **An evidence script may not report a result its own run did not produce.**
  Phase 6's rule, broken again by a script written after it: when the server
  died before the gate started, `gate-and-a11y.sh`'s summary read the JSON
  sitting on disk and printed the *previous* run's numbers as this run's. It
  stamps `RUN_STARTED_MS` now and prints `STALE` for anything older. Same
  family as the `postcommit-verify.sh` bug below.
- **A probe that guesses a field name will confidently answer the opposite of
  the truth.** `postcommit-verify.sh` read `j.results || j.places || j.shops`
  off `/api/discover` — the field is **`entries`** — and so printed "campus is
  SHUT" at 18:44 on a Tuesday with 17 of 22 places open, then skipped two whole
  suites on the strength of it. It survived its first run only because at 03:40
  the campus really was shut. Assert the shape; a zero and a parse failure must
  not look alike.
- **`AppShell` is instantiated per `<Route element>`, so anything that keeps
  state across navigations cannot live in it.** React reuses the instance only
  while the surrounding structure matches: `/`, `/search` and `/rank` are all
  `<RequireAuth><AppShell>` and reconcile to one instance, but `/:username` is
  a bare `<AppShell>` and `*` has no shell at all, so both MOUNT a fresh one.
  A "skip the first render" guard therefore re-arms and the effect never fires.
  Measured, focus one second after tapping Search: from `/` H1, from `/rank`
  H1, from `/maya` **body**, from a 404 **body**. `RouteFocus` lives outside
  `<Routes>` for exactly this reason, and it covers the journeys too.
- **The seeded academic calendar had autumn finals two days early, both years.**
  `finals_start` was the last day of *instruction*, not the first day of
  finals, in Autumn 2025 and Autumn 2026 but in neither spring term. Checked
  against OSU's published five-year view and corrected, along with a Summer
  2026 start that was two days late. If you touch `seed/academic-calendar.json`,
  `server/repo/discover.test.ts`'s `FINALS` fixture is coupled to it — and note
  its pair of dates must share a weekday, because the test's whole premise is
  that the open-shop set is identical and only the phase differs.
- **axe has never been able to answer the question people mean by
  "accessible".** It audits one static DOM: it cannot press Tab, and it has no
  opinion about what happened *between* two DOMs. Twelve green axe reports
  across seven phases said nothing at all about focus being dropped on every
  route change in the app. `node scripts/a11y-probe.mjs` covers what they
  cannot — tab order, focus indicators, accessible names, live regions, and
  focus on change. Its 10 standing warnings are deliberate: six *no skip link*
  (content precedes `<nav>` in DOM order here, so tabbing already starts in the
  content) and four *no live region* on surfaces with nothing async to say.

## Older gotchas (Phase 7 motion pass)

- **A `fullPage` screenshot can fail under load, and it is not the size cap.**
  `page.screenshot({fullPage:true})` on the mobile share page threw
  `Protocol error (Page.captureScreenshot): Unable to capture screenshot` once
  mid-suite beside a build and a server, then passed 3/3 in isolation. Measure
  before you chase it: that page is 2302 CSS px, i.e. 4604 device px at the
  suite's deviceScaleFactor, against Chromium's ~16384 texture cap — nowhere
  near it. Same cause as the Lighthouse spread. Retry; do not add a wait to a
  test that is already correct.

- **`:first-child` is about the WRAPPER, and half the columns here wrap.**
  `.cs-row:first-child { border-top: 0 }` is meant to suppress the hairline
  above the first row of a column. `<ol><li><Link class="cs-row">` makes every
  row the first child of its own list item, so every row matched — and since
  the hairlines *are* the structure of this design (no card, no shadow, no
  radius above 3 px), all seven list-semantic columns in the app rendered as
  one undifferentiated block. Twenty-two ranked places on `/rank` and on your
  own profile, six on a shared list, both group-session columns, both halves
  of the Maps import. It survived five phases because a missing hairline looks
  deliberate, and because the share page — a flat `<ol><li>` in
  `server/pages/shareList.ts` — was never affected, so the same list looked
  right on the surface everybody screenshotted. Fixed by three restore rules
  in `index.css`; held by `home.spec.ts`'s "every list column keeps its
  hairlines", which was proven to bite by deleting them and rebuilding.
- **A `//` comment inside `PAGE_JS` is a shredder.** The share page's inline
  script ships through `.replace(/\n/g,"")`, so a line comment inside it is
  joined onto one line and comments out every brace after it. The page renders
  perfectly, the chips stop working, and the only symptom is `Unexpected end of
  input` in a console nobody has open. Keep every comment about that script
  *outside* the template literal. Same file, same class of trap: a **backtick**
  in a comment inside `PAGE_CSS` ends the template literal — `` `cs-*` `` in an
  explanatory comment was a parse error four lines later. `shareList.test.ts`
  now parses the emitted `<script>` and proves the check bites.
- **The e2e suite cannot pass while the seeded campus is shut.** Four
  assertions need somewhere to be open — the hero query *is* "near me, open
  now, has outlets", and the Open-now chip asserts it "matches something in
  the seed" — and `open_now` is computed from the real system clock against
  `seed/shops.json`. The earliest weekday opening is **06:30** and the last
  close is 02:00, so a run between roughly 02:00 and 06:30 local goes red for
  the clock and not for the code. An hour of Phase 7 went into that.
  `scripts/phase7-evidence.sh` now refuses to start in that window and says
  why; the other five scripts do not. Same class as the freshness fixture
  Phase 6 found that expires on 2026-10-13 — this one expires every night.
- **:8787 is not reliably ours on this machine.** Another project in
  `Projects/delphi` runs `wrangler dev` on the same port, and `workerd` is
  supervised — kill it and a new one is listening within seconds, so there is
  no winning that fight. `scripts/phase7-evidence.sh` therefore takes
  `PORT=8791` and exports `COSIGN_BASE` from it; the server already read
  `PORT`, and `playwright.config.ts`, `scripts/lighthouse.mjs` and
  `scripts/boot-smoke.mjs` already read `COSIGN_BASE`. The five earlier
  evidence scripts still hardcode 8787 and will simply refuse to run.
- **Never edit a bash script while it is running.** Bash reads a script
  incrementally by byte offset, so an edit shifts everything after the cursor
  and the shell resumes mid-token. Fixing three `echo` lines in a running
  `phase7-evidence.sh` killed it 20 minutes in with `line 94: pair: unbound
  variable` — a line that is a comment, in a loop that is correct.
- **`settled(page)` on a surface that has not arrived yet answers instantly and
  about nothing.** It awaits `document.getAnimations()`, and a column that
  settles when its data lands starts its animations *after* that await was
  taken — so a sweep that goes `goto` → `settled` → axe is auditing whatever
  happened to be painted. Two a11y sweeps had been doing exactly that for
  phases and passed only because injecting axe takes long enough for React to
  commit; the first list with an arrival cascade made axe sample 618 elements
  mid-fade and call every one a contrast failure. `settled` now takes two
  passes with a frame between. Still wait for the surface first —
  `loaded(page, "[data-x]")`, or `waitForLoadState("networkidle")` where the
  helper has no single selector to watch.
- **Scroll-driven animations (`animation-timeline: view()`) are barred here,
  and not only on taste.** They never finish, so `settled()` in
  `e2e/fixtures.ts` — which awaits `document.getAnimations()` — would hang the
  whole suite; and `shot()` takes `fullPage` screenshots, which scroll, so
  every committed screenshot would catch rows mid-reveal. That is the Phase 3
  half-faded-axe-sample bug with a camera. The design position is the same
  answer: animate change, never reading.
- **`tailwind.config.ts` had five animations under a comment forbidding them.**
  `accordion-down/up` at 0.2 s animating *height*, `slide-up` 0.3 s, `fade-in`
  0.4 s, and `shimmer 2s linear infinite` — a perpetual motion nothing in this
  codebase could stop, because reduced motion is implemented by zeroing the
  duration tokens and none of the five read one. Nothing outside the (now
  deleted) shadcn tree ever used them. `motion.test.ts` fails on any of it.

## Older gotchas (Phase 6 closing pass)

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
- **331 kB main JS chunk** after build, 100 kB gzipped (446 kB before the Phase 6
  closing pass, which deleted two toast systems and a tooltip provider that
  `App.tsx` mounted and nothing used — 116 kB, a quarter of the bundle, for three
  things no screen rendered; 400 kB before Phase 5B; 382 kB before Phase 4; 345 kB
  before Phase 3's two pages; 672 kB before the external SDKs left).
  Code-splitting is still unaddressed; the share page must not ship this bundle at
  all — `e2e/share.spec.ts` asserts it requests zero `/assets/*.js` and zero
  stylesheets.
- **25 kB CSS, 6 kB gzipped** (56 kB / 10 kB before Phase 7 removed
  `tailwindcss-animate`). Deleting the 38 unused primitives did not move the JS —
  a file nothing imports never enters the graph — but the Tailwind plugin emitted
  its `animate-in` / `fade-*` / `zoom-*` / `slide-*` layer regardless, and that was
  **56% of the stylesheet** for utilities no screen used and none of which could be
  stopped by `prefers-reduced-motion`.
- `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`). Match
  existing style; don't fight it mid-phase.

## Hard rules (from the brief — never relitigate)

- **Zero external services.** Local SQLite (`node:sqlite`) / file persistence only.
  No API keys, no CDNs (fonts included — self-host), no remote backend. Maps/geo/auth
  behind provider interfaces with local stubs (fixed campus coordinate).
  **Phase 9 found the one credential that keeps this rule: passkeys.** WebAuthn
  needs no service — the authenticator is the person's own device and the only
  party is this server. It is the product's real sign-in; the dev user-switcher
  is now off unless `COSIGN_DEV_AUTH=1`. The cost is that there is **no account
  recovery**, which `DEPLOY.md` states plainly rather than papering over.
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

- Path alias `@/` → `src/`. **There is no shadcn tree any more.** `src/components/ui/`
  (38 generated primitives, 2,710 lines), `src/lib/utils.ts` and `components.json`
  are gone, and with them 40 dependencies — every `@radix-ui/*`, `framer-motion`,
  `lucide-react`, `cmdk`, `vaul`, `embla`, `react-day-picker`, `react-hook-form`,
  `zod`, `tailwindcss-animate`. Nothing outside that tree imported one line of it,
  and `components.json` was still configured for `baseColor: slate` — a config
  that would generate blue-grey components into a warm-espresso design system.
  The design system is `src/design/tokens.css` plus the `cs-*` layer; if a
  primitive is ever wanted again, add that one, not the set. Dependencies: **8**.
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
  the repo entirely).
- **Motion is three verbs and there is deliberately no fourth** (Phase 7). `DRAW` —
  a rule extends from its origin (`.cs-draw`, `.cs-stamp`, the live tab's mark, the
  margin mark of a chosen row, both SSR mastheads); `SETTLE` — something that has
  just arrived lands, 6 px and a fade (`.cs-settle`, and `.cs-column` which is only
  sugar for setting its `--i` stagger by `:nth-child`); `PRESS` — the surface
  answers a finger inside `--duration-fast` (ground up a step, a pill seated 1 px,
  the margin mark drawing down). The rule the vocabulary rests on: **animate
  change, never reading.** No surface reveals itself as you scroll past it, because
  the list is not arriving — you are. Scroll-driven timelines were tried and
  rejected on two counts beyond taste (see the gotchas). Every duration is
  `var(--duration-*)`; `src/design/motion.test.ts` fails the suite on a literal
  time, an `infinite`, an `animation` that does not fill `both`, a keyframe that
  does not end at rest, or a stylesheet without the blanket reduced-motion block.
- **Ember has two jobs and gold has one.** Ember: the order (rank numerals, the
  active tab's rule, the selection mark) and the act of writing (`SAVE IT`, the
  `Log` tab). Gold: the label voice. They never do each other's job, and neither
  is ever a background for a large area.
- Data fetching via `@tanstack/react-query` (the log flow prefetches `shops` /
  `meta` / `ranking` on the entry pill's `pointerdown`, which is why the measured
  path makes exactly one request — the save). Motion via CSS on the duration
  tokens. **`framer-motion` and `tailwindcss-animate` are both uninstalled**, and
  `motion.test.ts` fails if either returns: `whileTap`, springs and `layoutId`
  ignore `prefers-reduced-motion`, and Tailwind's `animate-*` utilities are the
  same trap for the same reason — `animate-spin` is `spin 1s linear infinite` and
  no reduced-motion block reaches it. Reduced motion here is implemented by
  zeroing four tokens, so anything that spells its own duration is an animation
  nobody can turn off.
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
