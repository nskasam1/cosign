#!/usr/bin/env bash
# The Phase 5A gate, measured both ways, on an idle machine.
#
#   cd cosign/cosign-app && PORT=8791 bash scripts/gate-experiment.sh
#
# One question: how much of the /p/ failure is the page and how much is the
# accounting? Same build, same server, same two URLs, back to back —
#
#   simulate  Lantern re-times a full-speed trace against a graph, and charges
#             the first paint for every font that finished before it. On
#             localhost every font always finishes before it.
#   devtools  the browser is actually held to 150 ms / 1.6 Mbps, so the fonts
#             are subject to the link the budget is written about.
#
# Writes into evidence/scratch/gate (gitignored) — this is an experiment, not a
# phase's committed evidence. Kills leftover chrome first: CLAUDE.md has the
# receipt where 22 stray processes moved the same page by 177 ms.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
PORT="${PORT:-8791}"
export PORT
export COSIGN_BASE="http://localhost:$PORT"
OUT="scratch/gate"
SCRATCH="${TMPDIR:-/tmp}/cosign-gate.db"
RUNS="${LH_RUNS:-5}"
export LH_RUNS="$RUNS"

require_free_port "$PORT"
rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/gate-seed.log 2>&1 || { cat /tmp/gate-seed.log; exit 1; }
npm run build > /tmp/gate-build.log 2>&1 || { tail -20 /tmp/gate-build.log; exit 1; }
COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/gate-server.log 2>&1 &
SERVER=$!
trap 'stop_server "$SERVER" "$PORT"' EXIT
wait_for_port "$PORT" || { tail -20 /tmp/gate-server.log; exit 1; }

LIST=$(COSIGN_DB="$SCRATCH" node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.COSIGN_DB);
console.log(db.prepare(\"select token from share_tokens where kind='list' and revoked_at is null limit 1\").get().token)")
PROF=$(COSIGN_DB="$SCRATCH" node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.COSIGN_DB);
console.log(db.prepare(\"select token from share_tokens where kind='profile' and revoked_at is null limit 1\").get().token)")
echo "list token  $LIST"
echo "profile token $PROF"

kill_chrome() {
  powershell -NoProfile -Command \
    "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1
  sleep 1
}

run() { # run <urlpath> <label> <method>
  kill_chrome
  echo ""
  echo "───── $2  ($3, median of $RUNS) ─────"
  LH_METHOD="$3" MSYS_NO_PATHCONV=1 node scripts/lighthouse.mjs "$1" "$OUT" "$2"
  echo "  gate exit=$?"
}

run "/s/$LIST" "share-simulate"  simulate
run "/p/$PROF" "profile-simulate" simulate
run "/s/$LIST" "share-devtools"  devtools
run "/p/$PROF" "profile-devtools" devtools
kill_chrome

echo ""
echo "═════ summary ═════"
node -e '
const fs=require("fs");
const dir="../../evidence/scratch/gate";
const rows=["share-simulate","profile-simulate","share-devtools","profile-devtools"];
const pad=(s,n)=>String(s).padEnd(n);
console.log(pad("page / method",22), pad("LCP",9), pad("observed LCP",14), pad("perf",6), "runs");
for (const r of rows) {
  const f=`${dir}/lighthouse-${r}.json`;
  if (!fs.existsSync(f)) { console.log(pad(r,22),"— not measured"); continue; }
  const j=JSON.parse(fs.readFileSync(f,"utf8"));
  console.log(
    pad(r,22),
    pad(j.median.lcpMs+" ms",9),
    pad(j.median.observedLcpMs+" ms",14),
    pad(j.median.perf,6),
    j.runs.map(x=>x.lcpMs).join(" · "),
  );
}'
