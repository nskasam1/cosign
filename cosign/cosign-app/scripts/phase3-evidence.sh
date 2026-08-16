#!/usr/bin/env bash
# Phase 3 acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase3-evidence.sh
#
# Unlike Phase 2's harness this one owns the server, because the log flow
# WRITES: it seeds a scratch database, serves the built app against it, runs
# the suite, and stops. server/data/cosign.db is never touched, so the run is
# repeatable and the committed seed stays the committed seed.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="../../evidence/phase3"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase3.db"
mkdir -p "$OUT"

if curl -s -o /dev/null --max-time 2 http://localhost:8787/api/meta; then
  echo "Something is already listening on :8787 — stop it first." >&2
  echo "  PowerShell: Get-NetTCPConnection -LocalPort 8787 -State Listen" >&2
  exit 1
fi

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase3-seed.log 2>&1 || { cat /tmp/phase3-seed.log; exit 1; }
npm run build > /tmp/phase3-build.log 2>&1 || { tail -20 /tmp/phase3-build.log; exit 1; }
COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase3-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 40); do
  curl -s -o /dev/null --max-time 1 http://localhost:8787/api/meta && break
  sleep 0.5
done

{
  echo "# Phase 3 acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"

  echo; echo "## ./node_modules/.bin/tsc -b (project refs: app / node / server)"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -6

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -3

  echo; echo "## no rating-scale input anywhere — the criterion, as a mechanism"
  echo "\$ npx vitest run src/design/no-scales.test.ts"
  npx vitest run src/design/no-scales.test.ts 2>&1 | grep -E "Test Files|Tests|scanned" | tail -4
  echo "\$ the three scale-generating primitives are gone, deps and all:"
  echo "  ui/{progress,radio-group,chart}.tsx: $(ls src/components/ui 2>/dev/null | grep -cE '^(progress|radio-group|chart)\.tsx$')"
  echo "  react-progress|react-radio-group|recharts in package.json: $(grep -cE '"(@radix-ui/react-progress|@radix-ui/react-radio-group|recharts)"' package.json)"
  echo "  input[type=range|number] / role=slider|progressbar|radiogroup in src+server,"
  echo "  excluding the guard itself and full-line comments (the one remaining"
  echo "  match is the JSDoc in StatementRow explaining why it refuses them):"
  grep -rInE 'type="(range|number)"|role="(slider|progressbar|radiogroup)"' src server \
    --include=*.ts --include=*.tsx | grep -v no-scales.test | sed 's/^/    /'
  echo "    live (non-comment) matches: $(grep -rInE 'type="(range|number)"|role="(slider|progressbar|radiogroup)"' src server --include=*.ts --include=*.tsx | grep -v no-scales.test | grep -vE '^[^:]+:[0-9]+: *(//|\*|/\*)' | wc -l)"

  echo; echo "## the flow writes nothing it was not told, and forges nothing"
  echo "\$ POST /api/logs as u_noah, claiming to be u_maya and public:"
  COOKIE=$(curl -s -i -X POST -H 'Content-Type: application/json' -d '{"userId":"u_noah"}' \
    http://localhost:8787/api/auth/switch | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
  curl -s -X POST -H 'Content-Type: application/json' -H "Cookie: $COOKIE" \
    -d '{"shop_id":"s_wheelhouse","intent_tag":"deep_work","user_id":"u_maya","visibility":"public"}' \
    http://localhost:8787/api/logs | node -e "
      const j=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
      console.log('   stored user_id  ', j.log.user_id, '(cookie said u_noah)');
      console.log('   stored visibility', j.log.visibility, '(body asked for public)');
      console.log('   stamped server-side:', j.log.time_bucket, '/', j.log.semester);
    "
  echo "\$ the enums are enforced by the route, not only by a CHECK constraint:"
  for body in '{"shop_id":"s_wheelhouse","intent_tag":"deep_work","noise":3}' \
              '{"shop_id":"s_wheelhouse","intent_tag":"deep_work","crowd":"heaving"}' \
              '{"shop_id":"s_wheelhouse","intent_tag":"deep_work","photo":"../../etc/passwd"}' \
              '{"intent_tag":"deep_work"}'; do
    printf '   %-70s -> %s\n' "$body" \
      "$(curl -s -o /tmp/p3.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
         -H "Cookie: $COOKIE" -d "$body" http://localhost:8787/api/logs) $(cat /tmp/p3.json)"
  done

  echo; echo "## the seeded state this run starts from"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    const n = (t: string) => (db.prepare('SELECT count(*) n FROM ' + t).get() as any).n;
    console.log('    users=' + n('users'), 'rankings=' + n('rankings'), 'logs=' + n('logs'),
                'ranking_entries=' + n('ranking_entries'), 'comparisons=' + n('comparisons'));
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
} > "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"

# The share regression runs FIRST, against the untouched seed. Run it after
# the log suite and it would measure a database full of test accounts — the
# cosign counts on the share page would move, and its artifacts would no
# longer be the Phase 2 record. COSIGN_EVIDENCE keeps both suites' output
# inside evidence/phase3/ (and out of evidence/phase2/, which is committed);
# --reporter=list stops it overwriting the log suite's results JSON.
echo "re-running the phase 2 share suite as a regression check (clean seed)…"
SHARE=$(COSIGN_EVIDENCE=phase3/share-regression npx playwright test share.spec.ts --reporter=list 2>&1 | tail -3)
echo "$SHARE"
# Its screenshots would be ~7 MB of near-duplicates of evidence/phase2/, which
# is committed and unchanged. The pass count in the transcript, plus the axe
# reports, are the part of this run worth keeping.
rm -f "$OUT"/share-regression/*.png

echo "running the phase 3 suite (both viewports)…"
LOG=$(COSIGN_EVIDENCE=phase3 npx playwright test log.spec.ts 2>&1 | tail -4)
echo "$LOG"

# The numbers land after the transcript is written, so fold them back in.
{
  echo; echo "## playwright"
  echo "\$ COSIGN_EVIDENCE=phase3/share-regression npx playwright test share.spec.ts   # phase 2, clean seed"
  echo "$SHARE" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase3 npx playwright test log.spec.ts                      # phase 3, both viewports"
  echo "$LOG" | sed 's/^/    /'

  echo; echo "## what the run wrote — every account it created ranked through the flow"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    // The suite signs up fresh accounts rather than reusing a seeded empty
    // user, so these rows are exactly what the log flow produced.
    const seeded = \"('maya','dev','june','theo','priya','sam','lena','noah')\";
    const fresh = db.prepare('SELECT id, username FROM users WHERE username NOT IN ' + seeded).all() as any[];
    for (const u of fresh) {
      const r = db.prepare('SELECT visibility, updated_at FROM rankings WHERE user_id = ?').get(u.id) as any;
      const n = (db.prepare('SELECT count(*) n FROM ranking_entries WHERE user_id = ?').get(u.id) as any).n;
      const l = (db.prepare('SELECT count(*) n FROM logs WHERE user_id = ?').get(u.id) as any).n;
      console.log('    @' + u.username, '· logs=' + l, '· ranked=' + n,
                  '· rankings row=' + (r ? r.visibility : 'MISSING'));
    }
    const ev = db.prepare(\"SELECT count(*) n FROM analytics_events WHERE event='ranking_inserted'\").get() as any;
    console.log('    analytics ranking_inserted rows:', ev.n);
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## measured (this run)"
  echo "\$ cat evidence/phase3/taps-mobile.json"; cat "$OUT/taps-mobile.json" 2>/dev/null
  echo; echo "\$ cat evidence/phase3/timing.json"; cat "$OUT/timing.json" 2>/dev/null
  echo; echo "\$ axe violations per surface (serious/critical):"
  for f in "$OUT"/axe-*.json; do
    printf '   %-34s %s\n' "$(basename "$f")" "$(node -e "
      const j=require('node:fs').readFileSync(process.argv[1],'utf8');
      const v=JSON.parse(j).violations.filter(x=>x.impact==='serious'||x.impact==='critical');
      console.log(v.length + ' (' + JSON.parse(j).passes + ' passes)');
    " "$f")"
  done
} >> "$OUT/commands.txt" 2>&1

echo "done — $OUT"
