# Cosign

Social place-discovery for college students: places near campus, cosigned by the
people you'd actually ask. One person's ranked list, shared as one link. Rebuilt
from its previous incarnation as a solo coffee-logging app ("Sip") — see
`MIGRATION_NOTES.md` for the original migration audit, and `../../PLAN.md` at the
repo root for the current build plan, architecture decisions, and status.

## Stack

- React + TypeScript + Vite (SPA shell)
- Tailwind CSS + shadcn/ui
- Local Hono server + SQLite (`node:sqlite`) for persistence, the SSR share
  pages, and OG images — **zero external services, zero API keys** (no Supabase,
  no Google APIs; those were removed in the rebuild)

## Setup

Requires Node ≥ 24 and npm (bun is not used).

```
npm install
npm run dev      # Vite dev server on :8080
npm test         # Vitest
npm run build    # production build
```

No `.env` is needed — there are deliberately no keys or remote services to
configure. See `../../CLAUDE.md` for the full command table and gotchas.
