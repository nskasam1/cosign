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
| Typecheck | `npx tsc -b` | project refs: app / node / server |
| Unit tests | `npm test` | Vitest, single run (~8 s, 49 tests) |
| Lint | `npm run lint` | ESLint flat config (8 pre-existing warnings, 0 errors) |
| Bulk shop entry | `npm run import:shops -- f.csv [--dry-run]` | merges by id into `seed/shops.json` |
| Shops → spreadsheet | `npm run export:shops -- f.csv` | round-trips back through import |
| Phase 1 evidence | `bash scripts/phase1-evidence.sh` | needs the prod server up |
| SPA boot smoke | `node scripts/boot-smoke.mjs` | needs the prod server up |

The Phase 2/5A Lighthouse gates run against `npm run prod` — **never**
`vite preview`, which bypasses SSR and measures the wrong thing.

## Gotchas (verified on this machine, updated 2026-08-15 after Phase 1)

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
- **Playwright: browsers are installed** (chromium v1217) and `scripts/boot-smoke.mjs`
  drives them directly. The old Lovable `playwright.config.ts` is deleted; Phase 2
  writes a standard config. Zero spec files exist yet.
- **Windows dev machine.** Paths contain a space (`Vineet Sista`) — always quote.
  Git Bash is available for POSIX scripts; PowerShell 5.1 is the primary shell.
- **345 kB main JS chunk** after build (down from 672 kB once the external SDKs left).
  Code-splitting is a Phase 4 concern; the share page must not ship this bundle at all.
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
- Design tokens are HSL CSS vars in `src/index.css` consumed by
  `tailwind.config.ts` (single dark warm-gold palette today; Phase 2 commits the
  canonical tokens file — after that, never re-decide aesthetics ad hoc).
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
