#!/usr/bin/env bash
# The restated perf criterion, measured, plus the accessibility probe that goes
# past what axe can see.
#
#   cd cosign/cosign-app && PORT=8791 bash scripts/gate-and-a11y.sh
#
# Owns its server and a scratch database; writes into evidence/scratch/ unless
# COSIGN_EVIDENCE_OUT names somewhere else.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
PORT="${PORT:-8791}"
export PORT
export COSIGN_BASE="http://localhost:$PORT"
OUT="${COSIGN_EVIDENCE_OUT:-scratch/gate}"
SCRATCH="${TMPDIR:-/tmp}/cosign-gate.db"
RUNS="${LH_RUNS:-5}"
export LH_RUNS="$RUNS"

RUN_STARTED_MS=$(node -e 'console.log(Date.now())')
export RUN_STARTED_MS

require_free_port "$PORT"
rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/ga-seed.log 2>&1 || { cat /tmp/ga-seed.log; exit 1; }
npm run build > /tmp/ga-build.log 2>&1 || { tail -20 /tmp/ga-build.log; exit 1; }
COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/ga-server.log 2>&1 &
SERVER=$!
trap 'stop_server "$SERVER" "$PORT"' EXIT
wait_for_port "$PORT" || { tail -20 /tmp/ga-server.log; exit 1; }

tok() { COSIGN_DB="$SCRATCH" node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.COSIGN_DB);
console.log(db.prepare(\"select token from share_tokens where kind='$1' and revoked_at is null limit 1\").get().token)"; }
LIST=$(tok list)
PROF=$(tok profile)

kill_chrome() {
  powershell -NoProfile -Command \
    "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1
  sleep 1
}

FAIL=0
gate() { # gate <path> <label> <method>
  kill_chrome
  echo ""
  echo "───── $2 · $3 ─────"
  LH_METHOD="$3" MSYS_NO_PATHCONV=1 node scripts/lighthouse.mjs "$1" "$OUT" "$2" || FAIL=1
}

# The gate first and alone. Stacking four Lighthouse arms and then a browser
# probe took the server out from under the third arm twice on this machine —
# clean start, no crash in its log, killed by contention — and a Lighthouse run
# against a dead server reports perf 0 and every metric 0, which reads exactly
# like a catastrophic regression instead of like nothing at all. So each stage
# checks the server is still answering, and says so if it is not.
alive() {
  curl -s -o /dev/null --max-time 3 "$COSIGN_BASE/api/meta" && return 0
  echo "  !! the server stopped answering before this stage — measurement abandoned" >&2
  FAIL=1
  return 1
}

echo "═════ the restated criterion ═════"
alive && gate "/s/$LIST" "share"   simulate
alive && gate "/p/$PROF" "profile" simulate
kill_chrome

echo ""
echo "═════ accessibility: what axe cannot see ═════"
alive && { COSIGN_EVIDENCE="$OUT" node scripts/a11y-probe.mjs || FAIL=1; }

echo ""
echo "═════ summary ═════"
# Only report what THIS run produced. The first version read whatever JSON was
# on disk, so when the server died before the gate ever started it cheerfully
# printed the previous run's 977 ms and 1282 ms as if they were results — a
# script reporting a conclusion its own run had not reached, which is the
# failure this repo has now found in four separate evidence scripts. The run
# stamps a marker before it starts and the summary refuses anything older.
node -e '
const fs=require("fs"), dir="../../evidence/'"$OUT"'";
const pad=(s,n)=>String(s).padEnd(n);
console.log(pad("measurement",18), pad("criterion",16), pad("value",10), "verdict");
for (const r of ["share","profile"]) {
  const f=`${dir}/lighthouse-${r}.json`;
  if (!fs.existsSync(f)) { console.log(pad(r,18), "— missing"); continue; }
  const j=JSON.parse(fs.readFileSync(f,"utf8"));
  if (new Date(j.generatedAt).getTime() < Number(process.env.RUN_STARTED_MS)) {
    console.log(pad(r,18), "— STALE, left by an earlier run; this run did not measure it");
    continue;
  }
  console.log(pad(r,18), pad(j.criterion,16), pad(j.median.lcpMs+" ms",10), j.passed?"PASS":"FAIL",
    `(perf ${j.median.perf}, a11y ${j.median.a11y}, legacy 1.0s ${j.legacyPassed?"pass":"fail"})`);
}'
exit $FAIL
