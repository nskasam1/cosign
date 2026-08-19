#!/usr/bin/env bash
# Phase 9 — passkeys, and closing the credential-free door.
#
#   cd cosign/cosign-app && PORT=8791 bash scripts/phase9-evidence.sh
#
# Owns TWO servers and a scratch database, because the phase's central claim is
# about the difference between them:
#
#   $PORT      the way every other suite runs it — COSIGN_DEV_AUTH=1, so the
#              user switcher exists and the other 196 e2e tests can sign in.
#   $STRICT    the way a deployment would run it — NODE_ENV=production and no
#              COSIGN_DEV_AUTH at all. `POST /api/auth/switch` is 403 here, and
#              a passkey still gets you in. That pair of facts IS the phase.
#
# Both ports must be free. Same shape as scripts/phase4-evidence.sh, which
# stands a second server inside finals week for the same kind of reason: some
# claims are only provable by running the thing two ways at once.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/server.sh
OUT="../../evidence/phase9"
PORT="${PORT:-8791}"
STRICT="${STRICT_PORT:-8792}"
export PORT
export COSIGN_BASE="http://localhost:$PORT"
export COSIGN_STRICT_BASE="http://localhost:$STRICT"
export COSIGN_EVIDENCE=phase9
SCRATCH="${TMPDIR:-/tmp}/cosign-phase9.db"
mkdir -p "$OUT"

require_free_port "$PORT"
require_free_port "$STRICT"

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/p9-seed.log 2>&1 || { cat /tmp/p9-seed.log; exit 1; }
npm run build > /tmp/p9-build.log 2>&1 || { tail -20 /tmp/p9-build.log; exit 1; }

# The permissive one, as every other suite gets it.
COSIGN_DB="$SCRATCH" COSIGN_DEV_AUTH=1 npm run serve:prod > /tmp/p9-server.log 2>&1 &
SERVER=$!
# The strict one. NODE_ENV=production and COSIGN_DEV_AUTH deliberately unset —
# note `env -u`, because exporting it empty is not the same as not having it
# and this script's whole point is the difference.
PORT="$STRICT" COSIGN_DB="$SCRATCH" NODE_ENV=production env -u COSIGN_DEV_AUTH \
  npm run serve:prod > /tmp/p9-strict.log 2>&1 &
STRICT_PID=$!
trap 'stop_server "$SERVER" "$PORT"; stop_server "$STRICT_PID" "$STRICT"' EXIT

wait_for_port "$PORT" || { tail -20 /tmp/p9-server.log; exit 1; }
wait_for_port "$STRICT" || { tail -20 /tmp/p9-strict.log; exit 1; }

{
  echo "# Phase 9 evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"
  echo "# :$PORT COSIGN_DEV_AUTH=1   :$STRICT NODE_ENV=production, no COSIGN_DEV_AUTH"

  echo; echo "## the door, both ways"
  echo "\$ curl -X POST :$PORT/api/auth/switch -d '{\"userId\":\"u_maya\"}'"
  curl -s -o /dev/null -w "  permissive -> HTTP %{http_code}\n" -X POST \
    -H 'content-type: application/json' -d '{"userId":"u_maya"}' \
    "$COSIGN_BASE/api/auth/switch"
  echo "\$ curl -X POST :$STRICT/api/auth/switch -d '{\"userId\":\"u_maya\"}'"
  curl -s -w "  strict     -> HTTP %{http_code}  " -X POST \
    -H 'content-type: application/json' -d '{"userId":"u_maya"}' \
    "$COSIGN_STRICT_BASE/api/auth/switch"
  echo
  echo "\$ curl :$STRICT/api/auth/users"
  curl -s "$COSIGN_STRICT_BASE/api/auth/users"
  echo

  echo; echo "## sign-in options name nobody"
  curl -s -X POST -H 'content-type: application/json' -d '{}' \
    "$COSIGN_BASE/api/auth/passkey/authenticate/options" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const j=JSON.parse(s);
        console.log('  keys:', Object.keys(j).join(', '));
        console.log('  allowCredentials present:', 'allowCredentials' in j);
        console.log('  challenge bytes:', Buffer.from(j.challenge,'base64url').length);
      })"

  echo; echo "## ./node_modules/.bin/tsc -b"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test (unit)"
  npm test 2>&1 | tail -4

  echo; echo "## npx playwright test passkey.spec.ts"
  npx playwright test passkey.spec.ts 2>&1 | tail -6
  node -e "
    const r=require('$OUT/playwright-results.json');const s=r.stats||{};
    console.log('passkey.spec  passed='+s.expected,'failed='+s.unexpected,'flaky='+s.flaky,'skipped='+s.skipped);
  "
} > "$OUT/commands.txt" 2>&1

cat "$OUT/commands.txt"
