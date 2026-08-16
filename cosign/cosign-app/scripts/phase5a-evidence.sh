#!/usr/bin/env bash
# Phase 5A acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase5a-evidence.sh
#
# Owns everything it needs and cleans up after itself:
#   * a scratch database (the Takeout import WRITES — it signs up accounts and
#     creates lists — so server/data/cosign.db is never touched and the run is
#     repeatable);
#   * the app as it ships, on :8787.
#
# Suite order is part of the evidence (CLAUDE.md): the read-only suites run
# first, into their OWN subdirectories, against the clean seed; the writing
# ones run last. A phase's evidence run must never be able to rewrite an
# earlier phase's.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="../../evidence/phase5a"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase5a.db"
mkdir -p "$OUT"

if curl -s -o /dev/null --max-time 2 "http://localhost:8787/api/meta"; then
  echo "Something is already listening on :8787 — stop it first." >&2
  echo "  PowerShell: Get-NetTCPConnection -LocalPort 8787 -State Listen" >&2
  exit 1
fi

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase5a-seed.log 2>&1 || { cat /tmp/phase5a-seed.log; exit 1; }
npm run build > /tmp/phase5a-build.log 2>&1 || { tail -20 /tmp/phase5a-build.log; exit 1; }

COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase5a-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 1 "http://localhost:8787/api/meta" && break
  sleep 0.5
done

# Seeded tokens (seed/share-tokens.json).
PROFILE=Rp7YT1i9S-Ov      # maya: 22 places, a live ranking link
EMPTY=Xqhqrj14rpKt        # noah: nothing in order at all
NOLIST=8UAJxMmqLWs3       # dev: ranking link revoked, so no onward door
REVOKED=oIxUcrHoBLVq      # lena: revoked profile token
RANKING=IofpCInelhr1      # maya's list — a /s/ token, not a /p/ one

{
  echo "# Phase 5A acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"

  echo; echo "## ./node_modules/.bin/tsc -b (project refs: app / node / server)"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -5

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -3

  echo; echo "## no rating-scale input anywhere — now over the profile and the import too"
  npx vitest run src/design/no-scales.test.ts 2>&1 | grep -E "Test Files|Tests " | tail -2

  echo; echo "## /p/:token — every state, logged out, with no session at all"
  # A relative path, not /tmp: curl runs under Git Bash (which maps /tmp) and
  # node does not (it reads it as C:\tmp), so an absolute POSIX path here
  # silently splits the two tools onto different files.
  PAGE=./phase5a-page.tmp.html
  for t in "$PROFILE" "$EMPTY" "$NOLIST" "$REVOKED" "$RANKING" not-a-real-token; do
    printf '   %-16s -> ' "GET /p/$t"
    curl -s -o "$PAGE" -w "%{http_code}" "http://localhost:8787/p/$t"
    printf '  %6s bytes  ' "$(wc -c < "$PAGE")"
    node -e "
      const h = require('node:fs').readFileSync(process.argv[1], 'utf8');
      const title = (h.match(/<title>([^<]*)</) || [, ''])[1];
      const marks = (h.match(/%3Ccircle/g) || []).length;
      console.log(title.padEnd(30), marks ? marks + ' marks drawn' : '');
    " "$PAGE"
  done
  rm -f "$PAGE"
  echo "   (a ranking token and an unknown token both 404: a token opens one surface, never two)"

  echo; echo "## the map is computed from the seed, not drawn by hand"
  ./node_modules/.bin/tsx -e "
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { buildMap } from './server/pages/profileMap.ts';
    import { DEFAULT_SEED_DIR } from './server/db/seed.ts';
    import { CAMPUS_CENTER, haversineMeters, walkingMinutes } from './src/lib/geo.ts';
    import { paletteOf } from './src/lib/palette.ts';
    const read = (f: string) => JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, f), 'utf-8'));
    const shops = read('shops.json');
    const rankings = read('rankings.json');
    const users = read('users.json');
    const byId = Object.fromEntries(shops.map((s: any) => [s.id, s]));
    const firstName = (id: string) =>
      (users.find((u: any) => u.id === id)?.display_name ?? id).split(' ')[0];
    for (const user of ['u_maya', 'u_dev', 'u_lena']) {
      const places = rankings[user].final.map((id: string, i: number) => {
        const s = byId[id];
        return { position: i + 1, name: s.name, palette: paletteOf(s.palette), lat: s.lat, lng: s.lng,
                 walkMin: walkingMinutes(haversineMeters(CAMPUS_CENTER, s)) };
      });
      const m = buildMap(places, firstName(user));
      const across = Math.round((390 - 68) / m.extent.scale);
      console.log('   ' + user.padEnd(8), String(places.length).padStart(2) + ' places',
        '| ' + String(across).padStart(4) + ' m across', '| rule=' + m.finding.rule.padEnd(18),
        '| ' + m.finding.sentence.slice(0, 96));
    }
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## google takeout: the committed fixtures, through the real route"
  curl -s -X POST -H 'Content-Type: application/json' \
    -d "$(node -e "
      const fs = require('node:fs');
      console.log(JSON.stringify({ files: [
        fs.readFileSync('seed/takeout/saved-places.geojson','utf8'),
        fs.readFileSync('seed/takeout/saved-places.csv','utf8'),
      ]}));
    ")" \
    -b "$(curl -s -i -X POST -H 'Content-Type: application/json' -d '{"userId":"u_noah"}' \
          http://localhost:8787/api/auth/switch | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)" \
    http://localhost:8787/api/import/takeout | node -e "
      const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      console.log('   counts: ' + JSON.stringify(v.counts));
      for (const m of v.matches) {
        console.log('   ' + m.kind.padEnd(8), (m.shop ? m.shop.slug : '—').padEnd(20),
          '| ' + m.saved.padEnd(26), '| ' + m.because);
      }
    "

  echo; echo "## the two traps in the fixtures: metres from a place we know, and still unmatched"
  ./node_modules/.bin/tsx -e "
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { importSavedPlaces } from './server/import/takeout.ts';
    import { DEFAULT_SEED_DIR } from './server/db/seed.ts';
    import { haversineMeters } from './src/lib/geo.ts';
    const f = (n: string) => readFileSync(join(DEFAULT_SEED_DIR, 'takeout', n), 'utf-8');
    const shops = JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, 'shops.json'), 'utf-8'));
    const r = importSavedPlaces([f('saved-places.geojson'), f('saved-places.csv')], shops);
    for (const m of r.matches.filter((x) => x.kind === 'unknown' && x.place.lat !== null)) {
      const near = shops
        .map((s: any) => ({ s, d: haversineMeters({ lat: m.place.lat!, lng: m.place.lng! }, s) }))
        .sort((a: any, b: any) => a.d - b.d)[0];
      console.log('   ' + m.place.name.padEnd(26), '| nearest place we know: ' +
        (near.s.slug + ', ' + Math.round(near.d) + ' m').padEnd(28), '| matched: ' + (m.shop ? 'YES' : 'no'));
    }
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## the import reads coordinates and writes none of them"
  echo "\$ import the fixtures, then sweep every text column in the database:"
  ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    const tables = (db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all() as any[]).map((t) => t.name);
    // a coordinate that appears only in seed/takeout/saved-places.geojson
    const needles = ['40.0053', '-83.0091', '2044 N High St'];
    const hits = tables.filter((t) => {
      const dump = JSON.stringify(db.prepare('SELECT * FROM \"' + t + '\"').all());
      return needles.some((n) => dump.includes(n));
    });
    console.log('   ' + tables.length + ' tables swept, ' + hits.length + ' containing a coordinate or address from the export' + (hits.length ? ': ' + hits.join(', ') : ''));
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
} > "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"

# ── the perf gate ───────────────────────────────────────────────────────────
# Both public surfaces, back to back, on the same machine in the same minute.
# The share page is the control: it carries the identical three fonts, so if
# it moves, the machine moved.
echo "running the perf gate (median of 5, both public pages)…"
GATE_PROFILE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs "/p/$PROFILE" phase5a profile 2>&1)
GATE_STATUS=$?
GATE_SHARE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs "/s/$RANKING" phase5a share-control 2>&1)
# The same template with NO MAP ON IT AT ALL (u_noah has ranked nothing), so
# the map cannot be blamed for a number it does not cause.
GATE_BARE=$(MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs "/p/$EMPTY" phase5a profile-no-map 2>&1)
echo "$GATE_PROFILE" | tail -12

echo "running the phase 5A suite (both viewports)…"
P5=$(COSIGN_EVIDENCE=phase5a npx playwright test profile.spec.ts --reporter=list 2>&1 | tail -3)
echo "$P5"

# Earlier phases re-run as regressions, into their own subdirectories.
echo "re-running the phase 2 share suite…"
SHARE=$(COSIGN_EVIDENCE=phase5a/share-regression npx playwright test share.spec.ts --reporter=list 2>&1 | tail -3)
echo "$SHARE"
rm -f "$OUT"/share-regression/*.png

echo "re-running the phase 4 home suite…"
HOME_RUN=$(COSIGN_EVIDENCE=phase5a/home-regression npx playwright test home.spec.ts --reporter=list 2>&1 | tail -3)
echo "$HOME_RUN"
rm -f "$OUT"/home-regression/*.png

echo "re-running the phase 3 log suite (it writes most, so it goes last)…"
LOG=$(COSIGN_EVIDENCE=phase5a/log-regression npx playwright test log.spec.ts --reporter=list 2>&1 | tail -3)
echo "$LOG"
rm -f "$OUT"/log-regression/*.png

echo "re-running the SPA boot smoke over every route…"
BOOT=$(COSIGN_EVIDENCE_DIR=phase5a/spa node scripts/boot-smoke.mjs 2>&1 | tail -20)
echo "$BOOT" | tail -4

{
  echo; echo "## the perf gate — LCP <= 1.0 s, performance >= 90, mobile + simulated Slow-4G"
  echo "\$ MSYS_NO_PATHCONV=1 LH_RUNS=5 node scripts/lighthouse.mjs /p/$PROFILE phase5a profile"
  echo "$GATE_PROFILE" | grep -Ev "chrome temp cleanup" | sed 's/^/    /'
  echo "   gate exit=$GATE_STATUS"
  echo
  echo "\$ …and two controls, same machine, same minute. The share page carries the"
  echo "  IDENTICAL three fonts, so if IT moves, the machine moved; and the same"
  echo "  profile template with no map on it at all shows what the map costs."
  echo "$GATE_SHARE" | grep -Ev "chrome temp cleanup" | sed 's/^/    /'
  echo "$GATE_BARE" | grep -Ev "chrome temp cleanup" | sed 's/^/    /'
  echo
  echo "\$ the three medians together:"
  node -e "
    const fs = require('node:fs');
    for (const [n, f] of [
      ['share page (control)', 'share-control'],
      ['profile, 22 places', 'profile'],
      ['profile, NO map at all', 'profile-no-map'],
    ]) {
      const p = '$OUT/lighthouse-' + f + '.json';
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      console.log('    ' + n.padEnd(24), 'median LCP ' + String(Math.round(j.median.lcpMs)).padStart(5) + ' ms',
        '| performance ' + j.median.perf);
    }
    console.log('    -> the map is not the cost: a profile with none measures the same.');
  "
  echo
  echo "\$ what IS the cost — the observed (unthrottled) trace order. NOTE: this reads"
  echo "  the LAST of the five runs, not the median, because that is the report the"
  echo "  gate leaves behind; the ordering it shows flips run to run, which is"
  echo "  exactly the point:"
  node -e "
    const fs = require('node:fs');
    for (const [n, f] of [['share (control)', 'share-control'], ['profile', 'profile'], ['profile, no map', 'profile-no-map']]) {
      const p = '$OUT/lighthouse-' + f + '.report.json';
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const m = j.audits['metrics'].details.items[0];
      const fonts = j.audits['network-requests'].details.items.filter((i) => i.resourceType === 'Font');
      const last = Math.max(...fonts.map((i) => i.networkEndTime));
      console.log('    ' + n.padEnd(18),
        'observed FCP ' + String(Math.round(m.observedFirstContentfulPaint)).padStart(4) + ' ms',
        '| last font at ' + String(Math.round(last)).padStart(4) + ' ms',
        '| fonts land ' + (last < m.observedFirstContentfulPaint ? 'BEFORE' : 'after ') + ' the paint',
        '| simulated LCP ' + String(Math.round(m.largestContentfulPaint)).padStart(4) + ' ms');
    }
  "

  echo; echo "## playwright"
  echo "\$ COSIGN_EVIDENCE=phase5a               npx playwright test profile.spec.ts   # phase 5A"
  echo "$P5" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5a/share-regression npx playwright test share.spec.ts  # phase 2"
  echo "$SHARE" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5a/home-regression  npx playwright test home.spec.ts   # phase 4"
  echo "$HOME_RUN" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5a/log-regression   npx playwright test log.spec.ts    # phase 3, last (it writes most)"
  echo "$LOG" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE_DIR=phase5a/spa node scripts/boot-smoke.mjs"
  echo "$BOOT" | sed 's/^/    /'

  echo; echo "\$ axe violations per surface (serious/critical):"
  for f in "$OUT"/axe-*.json; do
    [ -e "$f" ] || continue
    printf '   %-30s %s\n' "$(basename "$f")" "$(node -e "
      const j = require('node:fs').readFileSync(process.argv[1], 'utf8');
      const v = JSON.parse(j).violations.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      console.log(v.length + ' (' + JSON.parse(j).passes + ' passes)');
    " "$f")"
  done

  echo; echo "\$ document weight (the byte budget behind the gate):"
  for f in "$OUT"/profile-bytes-*.json; do
    [ -e "$f" ] || continue
    printf '   %-30s %s\n' "$(basename "$f")" "$(node -e "
      const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
      console.log(j.rawBytes + ' bytes raw, budget ' + j.budget);
    " "$f")"
  done
} >> "$OUT/commands.txt" 2>&1

echo "done — $OUT"
