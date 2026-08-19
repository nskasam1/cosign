# Cosign

Social place-discovery for college students: places near campus, cosigned by the
people you'd actually ask. One person's ranked list, shared as one link. Rebuilt
from its previous incarnation as a solo coffee-logging app ("Sip") — see
`MIGRATION_NOTES.md` for the original migration audit (historical — it predates
the local-server rebuild), and `../../PLAN.md` at the repo root for the current
build plan, architecture decisions, and status.

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
npm run seed     # builds server/data/cosign.db from seed/ — required, once
npm run dev      # Vite on :8080 + the API/SSR server on :8787
npm test         # Vitest
npm run prod     # build, then serve dist/ + the SSR pages from :8787
```

`npm run seed` is not optional: the database file is gitignored, so a fresh
clone has none and the server refuses to start without one. Re-run it after
pulling a change that touches `server/db/schema.sql` — the server checks on
startup and names the tables an older database is missing. Stop the server
first; SQLite holds the file open.

No `.env` is needed — there are deliberately no keys or remote services to
configure. See `../../CLAUDE.md` for the full command table and gotchas.
