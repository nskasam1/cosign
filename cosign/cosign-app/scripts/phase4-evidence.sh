#!/usr/bin/env bash
# Phase 4 acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase4-evidence.sh
#
# Owns everything it needs and cleans up after itself:
#   * a scratch database (the re-verify prompt WRITES — server/data/cosign.db
#     is never touched, so the run is repeatable and the committed seed stays
#     the committed seed);
#   * the app as it ships, on :8787;
#   * the SAME BUILD on :8788 pointed at a generated calendar whose finals
#     week contains today. That is the "mocked finals week" the phase asks
#     for: the academic calendar is a file (COSIGN_CALENDAR), and nothing in
#     the running server can move the date.
#
# The calendar fixture is generated rather than committed on purpose — a
# committed one would name dates that go stale the moment the clock passes
# them, and a test that has to be re-dated is a test nobody re-runs.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="../../evidence/phase4"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase4.db"
FINALS_CAL="${TMPDIR:-/tmp}/cosign-finals-calendar.json"
mkdir -p "$OUT"

for port in 8787 8788; do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$port/api/meta"; then
    echo "Something is already listening on :$port — stop it first." >&2
    echo "  PowerShell: Get-NetTCPConnection -LocalPort $port -State Listen" >&2
    exit 1
  fi
done

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase4-seed.log 2>&1 || { cat /tmp/phase4-seed.log; exit 1; }
npm run build > /tmp/phase4-build.log 2>&1 || { tail -20 /tmp/phase4-build.log; exit 1; }

# A term whose finals week contains today, written from today's date so it
# never needs re-dating. Same shape as seed/academic-calendar.json.
node -e "
  const d = new Date();
  const iso = (offset) => {
    const x = new Date(d.getTime() + offset * 86400000);
    return x.toISOString().slice(0, 10);
  };
  const cal = {
    school: 'osu',
    timezone: 'America/New_York',
    terms: [{
      slug: new Date().getFullYear() + '-autumn',
      name: 'Finals fixture',
      start: iso(-100), end: iso(7),
      week_one_end: iso(-94),
      finals_start: iso(-2),
    }],
  };
  require('node:fs').writeFileSync(process.argv[1], JSON.stringify(cal, null, 2));
" "$FINALS_CAL"

COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase4-server.log 2>&1 &
MAIN=$!
PORT=8788 COSIGN_DB="$SCRATCH" COSIGN_CALENDAR="$FINALS_CAL" npm run serve:prod > /tmp/phase4-finals.log 2>&1 &
FINALS=$!
trap 'kill $MAIN $FINALS 2>/dev/null' EXIT
for port in 8787 8788; do
  for _ in $(seq 1 40); do
    curl -s -o /dev/null --max-time 1 "http://localhost:$port/api/meta" && break
    sleep 0.5
  done
done

{
  echo "# Phase 4 acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"
  echo "# :8787 ships the committed calendar; :8788 the finals fixture below"

  echo; echo "## ./node_modules/.bin/tsc -b (project refs: app / node / server)"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -5

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -3

  echo; echo "## no rating-scale input anywhere — still a mechanism, now over five more surfaces"
  npx vitest run src/design/no-scales.test.ts 2>&1 | grep -E "Test Files|Tests " | tail -2

  echo; echo "## the hero query is the brief's, and it follows the position it is handed"
  for q in "" "?lat=39.9925&lng=-82.9964" "?lat=39.9812&lng=-83.0458"; do
    printf '   %-32s -> ' "GET /api/discover${q:-  (the stub: the Oval)}"
    curl -s "http://localhost:8787/api/discover$q" | node -e "
      const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      const hero = v.entries.find((e) => e.id === v.hero.shop_id);
      console.log(
        'at ' + v.at.lat + ',' + v.at.lng,
        '| matches=' + String(v.hero.matches).padStart(2),
        '| hero=' + (hero ? hero.name + ' (' + hero.walk_min + ' min, ' + hero.outlet_count + ' outlets)' : 'none — designed empty state'),
      );
    "
  done

  echo; echo "## mocked finals week: the same build, the same database, a different calendar file"
  echo "\$ cat \$COSIGN_CALENDAR   # generated from today, so it never needs re-dating"
  sed 's/^/    /' "$FINALS_CAL"; echo
  for base in http://localhost:8787 http://localhost:8788; do
    printf '   %-24s -> ' "$base"
    curl -s "$base/api/discover" | node -e "
      const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      const hero = v.entries.find((e) => e.id === v.hero.shop_id);
      console.log(
        'phase=' + v.phase.padEnd(13),
        'mode=' + v.hero.mode.padEnd(7),
        'matches=' + String(v.hero.matches).padStart(2),
        'hero=' + (hero ? hero.name + (hero.camp_ok ? ' [can stay, closes in ' + hero.closes_in_min + 'm]' : ' [turns tables]') : 'none'),
      );
    "
  done

  echo; echo "## friends outrank the crowd — the same database, four different viewers"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { getDb } from './server/db/db.ts';
    import { DEFAULT_SEED_DIR } from './server/db/seed.ts';
    import { discover } from './server/repo/discover.ts';
    const db = getDb();
    const cal = JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, 'academic-calendar.json'), 'utf-8'));
    const crowd = discover(db, cal, {}).entries.map((e) => e.id);
    for (const v of [null, 'u_lena', 'u_sam', 'u_maya']) {
      const mine = discover(db, cal, { viewerId: v }).entries;
      const moved = mine.filter((e, i) => crowd[i] !== e.id).length;
      const known = mine.filter((e) => e.friend_count > 0).length;
      console.log(
        '   ' + (v ?? 'logged out').padEnd(11),
        '| ' + String(moved).padStart(2) + ' of ' + mine.length + ' move',
        '| ' + String(known).padStart(2) + ' ranked by someone they know',
        '| top: ' + mine.slice(0, 3).map((e) => e.name).join(', '),
      );
    }
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## data age, straight from the seed timestamps"
  curl -s http://localhost:8787/api/discover | node -e "
    const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    const rows = v.entries.slice().sort((a, b) => (b.age.days ?? 1e9) - (a.age.days ?? 1e9));
    for (const e of [...rows.slice(0, 4), ...rows.slice(-3)]) {
      console.log('   ' + e.name.padEnd(22), String(Math.floor(e.age.days ?? -1)).padStart(4) + 'd', ' ' + e.age.label);
    }
  "

  echo; echo "## the position is read once and stored nowhere"
  echo "\$ GET /api/discover?lat=41.987654&lng=-87.123456, then sweep every table:"
  curl -s -o /dev/null "http://localhost:8787/api/discover?lat=41.987654&lng=-87.123456"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    const tables = (db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all() as any[]).map((t) => t.name);
    const hits = tables.filter((t) => JSON.stringify(db.prepare('SELECT * FROM \\\"' + t + '\\\"').all()).includes('41.987654'));
    console.log('   ' + tables.length + ' tables swept, ' + hits.length + ' containing the coordinate' + (hits.length ? ': ' + hits.join(', ') : ''));
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
} > "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"

# Earlier phases' suites re-run FIRST, against the untouched seed, into their
# own subdirectories — a phase's evidence must never be able to rewrite an
# earlier phase's (see CLAUDE.md; Phase 3 learned this the hard way).
echo "re-running the phase 2 share suite as a regression check…"
SHARE=$(COSIGN_EVIDENCE=phase4/share-regression npx playwright test share.spec.ts --reporter=list 2>&1 | tail -3)
echo "$SHARE"
rm -f "$OUT"/share-regression/*.png

# Phase 4 goes SECOND, not last. The Phase 3 log suite drives the real log
# flow as u_lena and therefore grows her ranking — run it first and Phase 4's
# screenshots show a Lena whose list this run built, with "your second"
# against a place she has never been. Phase 4's own writes (one freshness
# confirmation, a few fresh accounts) touch nothing Phase 3 reads, and Phase 3
# builds its own fixtures, so this order leaves both suites honest.
echo "running the phase 4 suite (both viewports)…"
HOME_RUN=$(COSIGN_EVIDENCE=phase4 COSIGN_FINALS_BASE=http://localhost:8788 npx playwright test home.spec.ts 2>&1 | tail -4)
echo "$HOME_RUN"

echo "re-running the phase 3 log suite as a regression check…"
LOG=$(COSIGN_EVIDENCE=phase4/log-regression npx playwright test log.spec.ts --reporter=list 2>&1 | tail -3)
echo "$LOG"
rm -f "$OUT"/log-regression/*.png

echo "re-running the SPA boot smoke over every route…"
BOOT=$(COSIGN_EVIDENCE_DIR=phase4/spa node scripts/boot-smoke.mjs 2>&1 | tail -4)
echo "$BOOT"

{
  echo; echo "## playwright"
  echo "\$ COSIGN_EVIDENCE=phase4/share-regression npx playwright test share.spec.ts   # phase 2, clean seed"
  echo "$SHARE" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase4 COSIGN_FINALS_BASE=… npx playwright test home.spec.ts  # phase 4, clean seed"
  echo "$HOME_RUN" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase4/log-regression   npx playwright test log.spec.ts     # phase 3, runs last (it writes most)"
  echo "$LOG" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE_DIR=phase4/spa node scripts/boot-smoke.mjs"
  echo "$BOOT" | sed 's/^/    /'

  echo; echo "## measured (this run)"
  for f in "$OUT"/friend-vs-crowd-*.json "$OUT"/finals-*.json; do
    [ -e "$f" ] || continue
    echo "\$ cat evidence/phase4/$(basename "$f")"
    node -e "
      const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
      const { friendsOrder, crowdOrder, ...rest } = j;
      console.log(JSON.stringify(rest, null, 2));
    " "$f" | sed 's/^/    /'
  done

  echo; echo "\$ axe violations per surface (serious/critical):"
  for f in "$OUT"/axe-*.json; do
    [ -e "$f" ] || continue
    printf '   %-28s %s\n' "$(basename "$f")" "$(node -e "
      const j = require('node:fs').readFileSync(process.argv[1], 'utf8');
      const v = JSON.parse(j).violations.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      console.log(v.length + ' (' + JSON.parse(j).passes + ' passes)');
    " "$f")"
  done
} >> "$OUT/commands.txt" 2>&1

echo "done — $OUT"
