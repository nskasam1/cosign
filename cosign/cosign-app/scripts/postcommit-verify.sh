#!/usr/bin/env bash
# Post-commit verification of the tree as committed — NOT a phase's evidence.
#
#   cd cosign/cosign-app && PORT=8791 bash scripts/postcommit-verify.sh
#
# Writes into evidence/scratch (gitignored) via COSIGN_EVIDENCE, so it cannot
# touch a signed-off phase. Owns its own scratch database because two of the
# three suites WRITE.
#
# It runs the three suites whose assertions do not depend on the seeded campus
# being open. home.spec and social.spec have four assertions that read
# `open_now` off the real system clock (earliest weekday opening 06:30, last
# close 02:00), so between roughly 02:00 and 06:30 local they go red for the
# clock and not for the code. This script says which side of that window it is
# on and runs the other two suites only when the campus is open.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
PORT="${PORT:-8791}"
export PORT
export COSIGN_BASE="http://localhost:$PORT"
export COSIGN_EVIDENCE=scratch/postcommit
OUT="../../evidence/scratch/postcommit"
SCRATCH="${TMPDIR:-/tmp}/cosign-postcommit.db"
mkdir -p "$OUT"

require_free_port "$PORT"
rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/pc-seed.log 2>&1 || { cat /tmp/pc-seed.log; exit 1; }
npm run build > /tmp/pc-build.log 2>&1 || { tail -20 /tmp/pc-build.log; exit 1; }
COSIGN_DEV_AUTH=1 COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/pc-server.log 2>&1 &
SERVER=$!
trap 'stop_server "$SERVER" "$PORT"' EXIT
wait_for_port "$PORT" || { tail -20 /tmp/pc-server.log; exit 1; }

# Ask the running server how many seeded places are open. The field is
# `entries` — the first version of this guessed `results|places|shops`, found
# none of them, and printed "campus is SHUT" at 18:44 on a Tuesday with the
# whole of High Street open. It then SKIPPED two suites on the strength of it.
# That is the Phase 6 rule broken by the script written to respect it: an
# evidence script may not print a conclusion its own numbers could contradict.
# So the shape is asserted now, and an unrecognised response is a hard failure
# rather than a zero that reads like a closed campus.
OPEN=$(curl -s "$COSIGN_BASE/api/discover?lat=40.0067&lng=-83.0305" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  let j; try { j = JSON.parse(s) } catch { console.log('BADJSON'); return }
  if (!Array.isArray(j.entries)) { console.log('BADSHAPE:' + Object.keys(j).join(',')); return }
  console.log(j.entries.filter(e => e.open_now).length);
})")
case "$OPEN" in
  BAD*)
    echo "Cannot read /api/discover — got $OPEN" >&2
    echo "  Refusing to guess whether the campus is open." >&2
    exit 1;;
esac
echo "seeded places open right now: $OPEN of 22  (local time $(date '+%H:%M %Z'))"

# Read-only first, writers last — an e2e that answers a fixture consumes it.
SUITES="share.spec.ts profile.spec.ts log.spec.ts"
if [ "$OPEN" != "0" ]; then
  SUITES="share.spec.ts profile.spec.ts social.spec.ts home.spec.ts log.spec.ts"
else
  echo "campus is SHUT — skipping home.spec.ts and social.spec.ts; their four"
  echo "open-now assertions would go red for the clock, not for the code."
fi

FAILED=0
for spec in $SUITES; do
  sub="${spec%.spec.ts}"
  COSIGN_EVIDENCE="scratch/postcommit/$sub" npx playwright test "$spec" > "/tmp/pc-$sub.log" 2>&1
  node -e "
    const r=require('$OUT/$sub/playwright-results.json');const s=r.stats||{};
    const bad=(s.unexpected||0)+(s.flaky||0);
    console.log('$spec'.padEnd(18), 'passed='+s.expected, 'failed='+s.unexpected, 'flaky='+s.flaky, 'skipped='+s.skipped);
    process.exit(bad?1:0)
  " || { FAILED=1; tail -30 "/tmp/pc-$sub.log"; }
done
exit $FAILED
