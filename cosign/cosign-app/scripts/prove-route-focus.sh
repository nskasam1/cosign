#!/usr/bin/env bash
# Prove the route-focus assertion can fail.
#
#   cd cosign/cosign-app && PORT=8791 bash scripts/prove-route-focus.sh
#
# A test that has never been seen to fail is a test that might be asserting
# nothing — this repo has found five of those. So: run it against the fix,
# then damage a COPY of the tree by removing the one call that implements it,
# rebuild, run it again, and put the source back either way.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
PORT="${PORT:-8791}"
export PORT
export COSIGN_BASE="http://localhost:$PORT"
export COSIGN_EVIDENCE=scratch/prove
SCRATCH="${TMPDIR:-/tmp}/cosign-prove.db"
SRC=src/App.tsx
BACKUP="${TMPDIR:-/tmp}/App.tsx.orig"
SPEC='a route change moves focus to the new page'

restore() {
  [ -f "$BACKUP" ] && cp "$BACKUP" "$SRC" && rm -f "$BACKUP"
  stop_server "${SERVER:-0}" "$PORT"
}
trap restore EXIT

require_free_port "$PORT"
cp "$SRC" "$BACKUP"
rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/prove-seed.log 2>&1 || { cat /tmp/prove-seed.log; exit 1; }
npm run build > /tmp/prove-build.log 2>&1 || { tail -20 /tmp/prove-build.log; exit 1; }
COSIGN_DEV_AUTH=1 COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/prove-server.log 2>&1 &
SERVER=$!
wait_for_port "$PORT" || { tail -20 /tmp/prove-server.log; exit 1; }

run() { npx playwright test home.spec.ts --project=mobile -g "$SPEC" 2>&1 | tail -4; }

echo "═════ 1. with <RouteFocus /> mounted (expect PASS) ═════"
run
WITH=$?

echo ""
echo "═════ 2. with the call removed (expect FAIL) ═════"
# Remove only the mount, never the component — what is being tested is that the
# behaviour is wired up, not that the file parses. Matched on the tag rather
# than on a fixed indentation, because the first version of this hard-coded two
# leading spaces, failed to match, and printed "could not find the call to
# remove" — which is at least loud. A quieter version of the same mistake would
# have rebuilt an unchanged tree, watched the test pass, and reported that the
# assertion does not bite.
node -e '
const fs=require("fs"), f=process.argv[1];
const s=fs.readFileSync(f,"utf8");
const out=s.replace(/^[ \t]*<RouteFocus \/>\r?\n/m,"");
if (out===s) { console.error("could not find <RouteFocus /> to remove"); process.exit(1) }
fs.writeFileSync(f,out);
' "$SRC" || exit 1
npm run build > /tmp/prove-build2.log 2>&1 || { tail -20 /tmp/prove-build2.log; exit 1; }
run
WITHOUT=$?

echo ""
echo "═════ restoring the source ═════"
cp "$BACKUP" "$SRC"
npm run build > /tmp/prove-build3.log 2>&1
echo "restored; exit codes: with=$WITH without=$WITHOUT"
[ "$WITHOUT" -ne 0 ] || { echo "!! the assertion did NOT bite — it passes with the fix removed" >&2; exit 1; }
echo "the assertion bites."
