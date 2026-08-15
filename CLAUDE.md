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
| Dev servers | `npm run dev` | Vite 8080 + Hono 8787 (concurrently); Vite proxies `/api,/img,/s,/p,/og` |
| Production | `npm run prod` | `vite build` then the server on 8787 serving `dist/` + SSR |
| Serve existing build | `npm run serve:prod` | skips the rebuild |
| Typecheck | `./node_modules/.bin/tsc -b` | project refs: app / node / server |
| Unit tests | `npm test` | Vitest, single run (~7 s warm, 81 tests) |
| Lint | `npm run lint` | ESLint flat config (8 pre-existing warnings, 0 errors) |
| Bulk shop entry | `npm run import:shops -- f.csv [--dry-run]` | merges by id into `seed/shops.json` |
| Shops → spreadsheet | `npm run export:shops -- f.csv` | round-trips back through import |
| Share-page e2e | `npx playwright test` | 24 tests, mobile + desktop; needs the prod server up |
| Perf gate | `MSYS_NO_PATHCONV=1 node scripts/lighthouse.mjs /s/<token> phase2 share` | exits non-zero if the gate misses |
| Phase 1 evidence | `bash scripts/phase1-evidence.sh` | needs the prod server up |
| Phase 2 evidence | `LH_RUNS=5 bash scripts/phase2-evidence.sh` | transcript + playwright + the gate |
| SPA boot smoke | `node scripts/boot-smoke.mjs` | `COSIGN_EVIDENCE_DIR=phase2/spa` to target a phase |

The Phase 2/5A Lighthouse gates run against `npm run prod` — **never**
`vite preview`, which bypasses SSR and measures the wrong thing.

`npx tsc` sometimes resolves to the unrelated `tsc` package on npm instead of
the local TypeScript; call `./node_modules/.bin/tsc` (or `.\node_modules\.bin\tsc.cmd`
in PowerShell) to be sure.

## Gotchas (verified on this machine, updated 2026-08-15 after Phase 2)

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
  `evidence/phase2/`. `scripts/boot-smoke.mjs` still drives chromium directly.
- **Windows dev machine.** Paths contain a space (`Vineet Sista`) — always quote.
  Git Bash is available for POSIX scripts; PowerShell 5.1 is the primary shell.
- **345 kB main JS chunk** after build (down from 672 kB once the external SDKs left).
  Code-splitting is a Phase 4 concern; the share page must not ship this bundle at all
  — `e2e/share.spec.ts` asserts it requests zero `/assets/*.js` and zero stylesheets.
- `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`). Match
  existing style; don't fight it mid-phase.

## Hard rules (from the brief — never relitigate)

- **Zero external services.** Local SQLite (`node:sqlite`) / file persistence only.
  No API keys, no CDNs (fonts included — self-host), no remote backend. Maps/geo/auth
  behind provider interfaces with local stubs (fixed campus coordinate).
- **No rating-scale inputs anywhere** — no stars, sliders, 1–10, numeric scales, or
  thumbs. Ranking input is head-to-head comparison only (binary-search insertion into
  the user's ordered list). Qualitative place data (noise etc.) uses labeled enum
  taps (e.g. `quiet / conversational / loud`), never numbers.
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
  colour anywhere else** — the one unavoidable duplication (satori has no CSS
  variables, so `server/pages/og.ts` repeats a dozen hex values) is guarded by a
  test.
- Data fetching via `@tanstack/react-query`; motion via `framer-motion` (subtle,
  purposeful; honor `prefers-reduced-motion`).
- Domain types in `src/types/cosign.ts`; pure domain logic in `src/lib/`
  (`semester.ts`, `timeBucket.ts` are keepers — see PLAN.md for their known bugs).
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
