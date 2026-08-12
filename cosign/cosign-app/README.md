# Cosign

Ranked recommendations from people you trust, scoped to one campus. Cosign is being
rebuilt from its previous incarnation as a solo coffee-logging app ("Sip") — see
`MIGRATION_NOTES.md` for what's changing and why. This README's feature list will be
rewritten once Phase 3 lands; until then it still describes the pre-rewrite app below.

## Stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Supabase (auth, database, storage, edge functions)
- Google Maps Places API

## Setup

1. Install dependencies:
   ```
   bun install
   ```

2. Copy `.env` and fill in your keys:
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   VITE_GOOGLE_MAPS_KEY=
   ```

3. Run locally:
   ```
   bun dev
   ```

## AI Tasting Notes

To enable AI-generated tasting notes, add your Anthropic API key as a Supabase secret:

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy generate-notes
```
