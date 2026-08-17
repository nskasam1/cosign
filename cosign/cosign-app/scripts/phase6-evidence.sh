#!/usr/bin/env bash
# Phase 6 — closing pass. Evidence for the defects this pass found and fixed,
# plus a full regression of every earlier phase's suite against the shipped
# build.
#
#   cd cosign/cosign-app && bash scripts/phase6-evidence.sh
#
# Owns everything it needs: a scratch database (several checks below WRITE),
# the built app on :8787, and its own evidence directory. No earlier phase's
# artifacts are touched — the regressions run into their own subdirectories,
# which is the pattern every phase since 3 has used.
#
# Unlike phase5a/5b this script does NOT pass `--reporter=list`. That flag
# REPLACES the reporter list in playwright.config.ts, which includes the JSON
# reporter — which is why evidence/phase5a/playwright-results.json was still a
# fossil of a superseded build that recorded four failures, under boxes that
# were checked on a later, passing run. The config's reporters are the point.
#
# The Lighthouse section is the phase's headline finding and is expected to
# exit non-zero on /p/: see PLAN.md. The `LH_BLOCK` runs are controls and can
# never report a pass.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
OUT="../../evidence/phase6"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase6.db"
STALE="${TMPDIR:-/tmp}/cosign-phase6-stale.db"
mkdir -p "$OUT"

require_free_port 8787

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase6-seed.log 2>&1 || { cat /tmp/phase6-seed.log; exit 1; }
npm run build > /tmp/phase6-build.log 2>&1 || { tail -20 /tmp/phase6-build.log; exit 1; }

COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase6-server.log 2>&1 &
SERVER=$!
trap 'stop_server "$SERVER" 8787' EXIT
wait_for_port 8787 || { tail -20 /tmp/phase6-server.log; exit 1; }

# Seeded tokens (seed/share-tokens.json).
PROFILE=Rp7YT1i9S-Ov      # maya: 22 places
RANKING=IofpCInelhr1      # maya's list — a /s/ token
JAR=/tmp/phase6-cookies.txt

{
  echo "# Phase 6 closing-pass evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"

  echo; echo "## ./node_modules/.bin/tsc -b — and e2e/ is finally inside it"
  ./node_modules/.bin/tsc -b; echo "exit=$?"
  echo "\$ grep -c references -A6 tsconfig.json  # projects in the build graph"
  node -e "const c=require('fs').readFileSync('tsconfig.json','utf8');console.log((c.match(/tsconfig\.[a-z0-9]+\.json/g)||[]).join(' '))"

  echo; echo "## npm test"
  npm test 2>&1 | grep -E "Test Files|Tests " | sed 's/^/    /'

  echo; echo "## npm run lint"
  npm run lint 2>&1 | grep -E "problems|error" | sed 's/^/    /'

  echo; echo "## the stale-database guard: a schema change used to surface as a bare 500"
  echo "\$ # a database built before Phase 5B added list_reranks, opened by the server"
  rm -f "$STALE" "$STALE"-shm "$STALE"-wal
  COSIGN_DB="$STALE" npm run seed > /dev/null 2>&1
  node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(process.argv[1]);
    db.exec('DROP TABLE list_reranks');
    db.close();
  " "$STALE" 2>/dev/null
  COSIGN_DB="$STALE" npx tsx -e "import('./server/db/db.ts').then(m=>{try{m.getDb();console.log('    NO ERROR — the guard did not fire')}catch(e){console.log('    '+e.message)}})" 2>&1 | grep -v -i "experimental\|trace-warnings"
  echo "    (before this guard: GET /api/lists/:id answered 500 'no such table', every other route answered fine)"

  echo; echo "## the founder's CSV round trip is lossless (IMPORT_FORMAT.md §5)"
  echo "\$ npm run export:shops -- /tmp/phase6-shops.csv && npm run import:shops -- /tmp/phase6-shops.csv --dry-run"
  npm run export:shops -- /tmp/phase6-shops.csv 2>&1 | grep -v -i "experimental\|trace-warnings" | tail -1 | sed 's/^/    /'
  npm run import:shops -- /tmp/phase6-shops.csv --dry-run 2>&1 | grep -v -i "experimental\|trace-warnings" | grep -E "rows|added|updated" | sed 's/^/    /'
  npx vitest run server/import/roundtrip.test.ts 2>&1 | grep -E "Tests |lossless" | sed 's/^/    /'
  echo "    (before the fix: 22 wifi_notes, 22 camp_notes and 18 palettes were nulled by the documented command)"

  echo; echo "## /g/:token is the third public token-addressed surface, and now says so"
  echo "\$ curl -sI localhost:8787/g/anything | grep -i x-robots-tag"
  curl -sI "http://localhost:8787/g/g_notatable0000" | grep -i "x-robots-tag" | sed 's/^/    /'
  echo "\$ grep Disallow public/robots.txt"
  grep "Disallow" public/robots.txt | sed 's/^/    /'

  echo; echo "## a log count is an answer about friends-only rows, so it is gated like one"
  echo "\$ curl -s localhost:8787/api/users/maya            # logged out"
  curl -s "http://localhost:8787/api/users/maya" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);console.log('    logs_count='+j.logs_count+' can_see_ranking='+j.can_see_ranking);});"
  rm -f "$JAR"
  curl -s -c "$JAR" -X POST -H "Content-Type: application/json" -d '{"userId":"u_dev"}' \
    "http://localhost:8787/api/auth/switch" -o /dev/null
  echo "\$ curl -s --cookie <u_dev, an accepted friend> localhost:8787/api/users/maya"
  curl -s -b "$JAR" "http://localhost:8787/api/users/maya" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);console.log('    logs_count='+j.logs_count+' can_see_ranking='+j.can_see_ranking);});"

  echo; echo "## the hero surface with nothing on it — a link minted before its owner ranked anywhere"
  rm -f "$JAR"
  NEW=$(curl -s -c "$JAR" -X POST -H "Content-Type: application/json" \
    -d '{"username":"phase6probe","display_name":"Robin Vale","school_id":"osu"}' \
    "http://localhost:8787/api/auth/create")
  EMPTY_TOKEN=$(curl -s -b "$JAR" -X POST -H "Content-Type: application/json" -d '{"kind":"ranking"}' \
    "http://localhost:8787/api/share" | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        try{console.log(JSON.parse(s).token.token)}catch{console.log('')}});")
  echo "\$ curl -s localhost:8787/s/<a token for an empty ranking>"
  curl -s "http://localhost:8787/s/$EMPTY_TOKEN" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const has=(t)=>s.includes(t);
      console.log('    data-empty          : '+has('data-empty'));
      console.log('    \"All 0, in order\"   : '+has('All 0, in order'));
      console.log('    an empty <ol>       : '+has('<ol>'));
      console.log('    the filter script   : '+has('data-chip-all'));
      console.log('    still names the author and the door out: '+(has('Robin Vale')&&has('/onboarding')));});"

  echo; echo "## every surface, re-run against this build (the config's JSON reporter writes each results file)"
} > "$OUT/commands.txt" 2>&1

# Read-only first, writers last, each into its own directory (CLAUDE.md).
SHARE=$(COSIGN_EVIDENCE=phase6/share-regression npx playwright test share.spec.ts 2>&1 | tail -3)
PROFILE_RUN=$(COSIGN_EVIDENCE=phase6/profile-regression npx playwright test profile.spec.ts 2>&1 | tail -3)
SOCIAL=$(COSIGN_EVIDENCE=phase6/social-regression npx playwright test social.spec.ts 2>&1 | tail -3)
HOME_RUN=$(COSIGN_EVIDENCE=phase6/home-regression npx playwright test home.spec.ts 2>&1 | tail -3)
LOG=$(COSIGN_EVIDENCE=phase6/log-regression npx playwright test log.spec.ts 2>&1 | tail -3)
BOOT=$(COSIGN_EVIDENCE_DIR=phase6/spa node scripts/boot-smoke.mjs 2>&1 | tail -6)

# The screenshots belong to the phase that was accepted on them; what a
# regression is evidence of is that the suite still passes against today's
# build, which is the results JSON and the axe reports.
rm -f "$OUT"/*-regression/*.png "$OUT"/spa/*.png

{
  for pair in "share:phase 2" "profile:phase 5A" "social:phase 5B" "home:phase 4" "log:phase 3"; do
    name="${pair%%:*}"; phase="${pair##*:}"
    echo "\$ COSIGN_EVIDENCE=phase6/${name}-regression npx playwright test ${name}.spec.ts   # ${phase}"
  done
  echo
  echo "    share   $(echo "$SHARE" | grep -E "passed|failed")"
  echo "    profile $(echo "$PROFILE_RUN" | grep -E "passed|failed")"
  echo "    social  $(echo "$SOCIAL" | grep -E "passed|failed")"
  echo "    home    $(echo "$HOME_RUN" | grep -E "passed|failed")"
  echo "    log     $(echo "$LOG" | grep -E "passed|failed")"
  echo
  echo "\$ COSIGN_EVIDENCE_DIR=phase6/spa node scripts/boot-smoke.mjs"
  echo "$BOOT" | sed 's/^/    /'
} >> "$OUT/commands.txt" 2>&1

# ── the perf gate, and what it can and cannot measure ────────────────────────
GATE_PROFILE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs "/p/$PROFILE" phase6 profile 2>&1)
GP=$?
GATE_SHARE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs "/s/$RANKING" phase6 share 2>&1)
GS=$?
# Controls: the same build and the same server answering the same URL with the
# fonts taken away. They price the three faces against the budget instead of
# arguing about them, and they are marked `blocked` in the JSON so neither can
# ever be read as a pass.
CTL_PROFILE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 LH_BLOCK="*/fonts/*" node scripts/lighthouse.mjs "/p/$PROFILE" phase6 profile-no-fonts 2>&1)
CTL_SHARE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 LH_BLOCK="*/fonts/*" node scripts/lighthouse.mjs "/s/$RANKING" phase6 share-no-fonts 2>&1)

{
  echo; echo "## the perf gate (LCP <= 1000 ms, median of 5, mobile + simulated Slow-4G)"
  echo "\$ LH_RUNS=5 node scripts/lighthouse.mjs /p/$PROFILE phase6 profile"
  echo "$GATE_PROFILE" | grep -E "LCP|performance|runs:" | sed 's/^/    /'
  echo "    gate exit=$GP"
  echo "\$ LH_RUNS=5 node scripts/lighthouse.mjs /s/$RANKING phase6 share"
  echo "$GATE_SHARE" | grep -E "LCP|performance|runs:" | sed 's/^/    /'
  echo "    gate exit=$GS"
  echo
  echo "## the same two pages with */fonts/* blocked — controls, never a pass"
  echo "\$ LH_BLOCK='*/fonts/*' LH_RUNS=5 node scripts/lighthouse.mjs /p/$PROFILE phase6 profile-no-fonts"
  echo "$CTL_PROFILE" | grep -E "LCP|runs:" | sed 's/^/    /'
  echo "\$ LH_BLOCK='*/fonts/*' LH_RUNS=5 node scripts/lighthouse.mjs /s/$RANKING phase6 share-no-fonts"
  echo "$CTL_SHARE" | grep -E "LCP|runs:" | sed 's/^/    /'
  echo
  echo "\$ node scripts/gate-summary.mjs phase6"
  node scripts/gate-summary.mjs phase6
  echo
  echo "    What this means for the criterion is in PLAN.md, Phase 6. Note that"
  echo "    machine load moves these numbers — CLAUDE.md has said so since Phase 2"
  echo "    — so the run above is one sample of a distribution, and the summary is"
  echo "    computed from it rather than written down beside it."
} >> "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"
tail -40 "$OUT/commands.txt"
