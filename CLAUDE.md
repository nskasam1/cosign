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
    └── cosign-app/      ← the entire app (Vite + React SPA; server/ added in Phase 1)
```

The double nesting (`cosign/cosign-app`) is historical (the app was a nested repo,
flattened in commit 177368b). Do not move it — every path below is relative to
`cosign/cosign-app/` unless stated otherwise.

## Commands

All run from `cosign/cosign-app/`. **npm is canonical** (Node ≥ 24 required — the
Phase 1 persistence layer uses the built-in `node:sqlite`). The README mentions bun;
bun is not installed on this machine and its lockfiles are legacy (to be removed in
Phase 1 — still present).

| Task | Command | Notes |
|---|---|---|
| Install | `npm install` | |
| Dev server | `npm run dev` | Vite, port 8080 |
| Production build | `npm run build` | ~45 s; outputs `dist/` |
| Typecheck | `npx tsc -b` | project refs: app / node / api |
| Unit tests | `npm test` | Vitest, single run |
| Lint | `npm run lint` | ESLint flat config |

Phase 1 adds `npm run seed` (build the SQLite DB from `seed/`) and `npm run prod`
(production build + local Hono server on 8787 serving `dist/` and the SSR share
routes). The Phase 2/5A Lighthouse gates run against `npm run prod` — **never**
`vite preview`, which bypasses SSR and measures the wrong thing.

## Gotchas (verified on this machine, 2026-08-15)

- **The SPA whitescreens at boot today.** `src/integrations/supabase/client.ts` calls
  `createClient` with env vars that don't exist (there is no `.env`, deliberately), and
  throws at module load. This is expected until Phase 1 replaces the data layer. Do
  **not** fix it by creating a `.env` or provisioning Supabase — the brief mandates
  zero external services (no Supabase, no Google APIs, no keys of any kind, ever).
- **Vitest startup is ~1–2 min** on this machine because `vitest.config.ts` sets a
  global `jsdom` environment. For pure-logic tests add `// @vitest-environment node`
  at the top of the file (or split configs) — node-env tests run in seconds.
- **Playwright config is dead.** `playwright.config.ts` / `playwright-fixture.ts`
  import `lovable-agent-playwright-config`, which is not installed and not on npm for
  us. Replace with a standard config when Playwright evidence is first needed
  (Phase 2); do not try to install the Lovable package. Zero spec files exist yet.
- **Windows dev machine.** Paths contain a space (`Vineet Sista`) — always quote.
  Git Bash is available for POSIX scripts; PowerShell 5.1 is the primary shell.
- **672 kB main JS chunk** after build (everything in one bundle). Code-splitting is a
  Phase 4 concern; the share page must not ship this bundle at all.
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
