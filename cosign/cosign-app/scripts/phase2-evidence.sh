#!/usr/bin/env bash
# Phase 2 acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase2-evidence.sh
#
# Owns everything it needs, the way every later phase script does: a scratch
# database seeded from seed/ (server/data/cosign.db is never touched, so the
# run is repeatable and the committed seed stays the committed seed) and the
# built app on :8787.
#
# It used to want `npm run prod` in another shell and then ran a bare
# `npx playwright test` — no spec filter, no COSIGN_EVIDENCE, and whatever
# database that server happened to hold. Once Phase 4 made COSIGN_EVIDENCE
# default to `scratch`, this script's screenshots, axe reports and OG snapshot
# went to the gitignored evidence/scratch/ while the header above still
# promised evidence/phase2/, and the unfiltered run also dragged in four later
# phases' specs against a database seeded for none of them.
#
# Writes to evidence/phase2/ at the repo root. The Playwright screenshots,
# axe reports, OG snapshot and Lighthouse numbers are written by
# `npx playwright test` and `node scripts/lighthouse.mjs`, which this script
# runs; everything else is transcript.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
OUT="../../evidence/phase2"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase2.db"
TOKEN="IofpCInelhr1"     # maya's ranking — the 22-place perf-gate list
REVOKED="e3lsicjJ4Q3S"
PROFILE="Rp7YT1i9S-Ov"
mkdir -p "$OUT"

require_free_port 8787

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase2-seed.log 2>&1 || { cat /tmp/phase2-seed.log; exit 1; }
npm run build > /tmp/phase2-build.log 2>&1 || { tail -20 /tmp/phase2-build.log; exit 1; }

COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase2-server.log 2>&1 &
SERVER=$!
trap 'stop_server "$SERVER" 8787' EXIT
wait_for_port 8787 || { tail -20 /tmp/phase2-server.log; exit 1; }

{
  echo "# Phase 2 acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"

  echo; echo "## npx tsc -b (project refs: app / node / server)"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -8

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -4

  echo; echo "## design tokens are one file, consumed by three surfaces"
  echo "\$ wc -c src/design/tokens.css"; wc -c < src/design/tokens.css
  echo "\$ grep -c 'var(--' tailwind.config.ts    # Tailwind reads the tokens"
  grep -c 'var(--' tailwind.config.ts
  echo "\$ head -4 src/index.css                  # the SPA imports them"
  head -4 src/index.css
  echo "\$ grep -n 'tokensCss()' server/pages/*.ts   # the SSR pages inline them"
  grep -n 'tokensCss()' server/pages/*.ts

  echo; echo "## self-hosted fonts (no CDN, OFL licences committed)"
  ls -l public/fonts server/assets/fonts | grep -v '^total\|^$'
  echo "\$ total woff2 shipped to the browser:"
  du -cb public/fonts/*.woff2 2>/dev/null | tail -1 || cat public/fonts/*.woff2 | wc -c

  echo; echo "## share page: SSR, logged out, no bundle, no stylesheet request"
  echo "\$ curl -s -o /dev/null -w '%{http_code} %{size_download}b %{time_total}s' /s/\$TOKEN"
  curl -s -o /dev/null -w '%{http_code} %{size_download}b %{time_total}s\n' "http://localhost:8787/s/$TOKEN"
  echo "\$ same request with gzip (what a browser actually gets):"
  curl -s -H 'Accept-Encoding: gzip' -o /tmp/share.gz -w 'transferred %{size_download}b\n' "http://localhost:8787/s/$TOKEN"
  echo "\$ script/link tags in the response (want: 0 src, 0 stylesheet):"
  echo "  script[src]:     $(curl -s "http://localhost:8787/s/$TOKEN" | grep -o '<script src' | wc -l)"
  echo "  link[stylesheet]:$(curl -s "http://localhost:8787/s/$TOKEN" | grep -o 'rel="stylesheet"' | wc -l)"
  echo "\$ decision-2 elements present in the HTML (markup only; the filter"
  echo "  script is stripped first so its selectors are not counted twice):"
  HTML=$(curl -s "http://localhost:8787/s/$TOKEN")
  MARKUP=$(printf '%s' "$HTML" | sed 's|<script>.*</script>||')
  for probe in 'data-author' 'data-entry' 'data-chip=' 'data-chip-all' 'data-cta' 'data-nophoto' 'data-cosign='; do
    printf '  %-16s %s\n' "$probe" "$(printf '%s' "$MARKUP" | grep -o "$probe" | wc -l)"
  done

  echo; echo "## token revocation and scope"
  echo "\$ curl /s/\$REVOKED     (expect 410 tombstone, never the list)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/s/$REVOKED"
  echo "\$ curl /og/s/\$REVOKED  (expect 410 — the picture is revoked too)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/og/s/$REVOKED"
  echo "\$ shop names leaked by the tombstone (want: 0)"
  curl -s "http://localhost:8787/s/$REVOKED" | grep -cE 'Lantern Lane|Wheelhouse|Foundry'
  echo "\$ curl /s/\$PROFILE     (profile-scoped token is not a list surface: expect 404)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/s/$PROFILE"
  echo "\$ curl /s/nope         (expect 404)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/s/nope"

  echo; echo "## open graph image"
  echo "\$ curl -sI /og/s/\$TOKEN"
  curl -s -o /dev/null -w 'status %{http_code}  %{content_type}  %{size_download}b  %{time_total}s\n' "http://localhost:8787/og/s/$TOKEN"

  echo; echo "## friends-only default still holds (cosigners on a public page)"
  echo "\$ rankings by visibility:"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    for (const r of db.prepare('SELECT visibility, count(*) n FROM rankings GROUP BY visibility').all())
      console.log('   ', JSON.stringify(r));
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
  echo "\$ every cosign line rendered on the public page — only people whose"
  echo "  own ranking is public are named; the rest are counted, never named:"
  printf '%s' "$MARKUP" | node -e "
    const html = require('node:fs').readFileSync(0, 'utf8');
    const lines = (html.match(/<p class=\"cosign\"[\s\S]*?<\/p>/g) ?? [])
      .map((p) => p.replace(/<[^>]*>/g, '').trim());
    const tally = new Map();
    for (const l of lines) tally.set(l, (tally.get(l) ?? 0) + 1);
    for (const [l, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 8))
      console.log('    ' + String(n).padStart(3) + '  ' + l);
  "
} > "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"

echo "running playwright (screenshots, axe, reduced motion, OG snapshot)…"
COSIGN_EVIDENCE=phase2 npx playwright test share.spec.ts 2>&1 | tail -3

echo "running the perf gate…"
# MSYS_NO_PATHCONV: Git Bash rewrites a leading-slash argument into a Windows
# path, so "/s/<token>" would reach Lighthouse as C:/Program Files/Git/s/...
MSYS_NO_PATHCONV=1 node scripts/lighthouse.mjs "/s/$TOKEN" phase2 share 2>&1 | tail -16
