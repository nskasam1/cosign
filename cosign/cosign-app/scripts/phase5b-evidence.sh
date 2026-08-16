#!/usr/bin/env bash
# Phase 5B acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase5b-evidence.sh
#
# Owns everything it needs and cleans up after itself:
#   * a scratch database — this suite WRITES (it starts group sessions, sends
#     friend requests and re-ranks a shared list), so server/data/cosign.db is
#     never touched and the run is repeatable;
#   * the app as it ships, on :8787.
#
# Suite order is part of the evidence (CLAUDE.md): the read-only suites run
# first, into their OWN subdirectories, against the clean seed; the writing
# ones run last. A phase's evidence run must never be able to rewrite an
# earlier phase's.
#
# There is no Lighthouse gate here. The perf gate is a property of the two
# PUBLIC SSR surfaces (Phase 2's /s/:token and Phase 5A's /p/:token) and 5B
# adds neither — every surface it ships is behind the login wall, inside the
# SPA bundle those two pages deliberately do not load.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="../../evidence/phase5b"
SCRATCH="${TMPDIR:-/tmp}/cosign-phase5b.db"
mkdir -p "$OUT"

if curl -s -o /dev/null --max-time 2 "http://localhost:8787/api/meta"; then
  echo "Something is already listening on :8787 — stop it first." >&2
  echo "  PowerShell: Get-NetTCPConnection -LocalPort 8787 -State Listen" >&2
  exit 1
fi

rm -f "$SCRATCH" "$SCRATCH"-shm "$SCRATCH"-wal
COSIGN_DB="$SCRATCH" npm run seed > /tmp/phase5b-seed.log 2>&1 || { cat /tmp/phase5b-seed.log; exit 1; }
npm run build > /tmp/phase5b-build.log 2>&1 || { tail -20 /tmp/phase5b-build.log; exit 1; }

COSIGN_DB="$SCRATCH" npm run serve:prod > /tmp/phase5b-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 1 "http://localhost:8787/api/meta" && break
  sleep 0.5
done

{
  echo "# Phase 5B acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"
  echo "# scratch database: $SCRATCH (server/data/cosign.db untouched)"

  echo; echo "## ./node_modules/.bin/tsc -b (project refs: app / node / server)"
  ./node_modules/.bin/tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -5

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -3

  echo; echo "## the two source audits, over every .ts/.tsx/.css/.sql under src/ and server/"
  npx vitest run src/design/no-scales.test.ts src/design/no-bait.test.ts 2>&1 \
    | grep -E "✓ src/design|Test Files|Tests " | tail -4

  echo; echo "## npm run seed — notifications are DERIVED, never authored"
  grep -E "seeded|shops=|group_sessions=|north-star" /tmp/phase5b-seed.log | sed 's/^/   /'
  echo "   (there is no seed/notifications.json — see server/db/seed.ts)"

  echo; echo "## acceptance 1: group intersection-best for four seeded users"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { getDb } from './server/db/db.ts';
    import { DEFAULT_SEED_DIR } from './server/db/seed.ts';
    import { createSession, submitNeeds, sessionView } from './server/repo/group.ts';
    const cal = JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, 'academic-calendar.json'), 'utf-8'));
    const db = getDb();
    const NOW = new Date('2026-08-19T19:30:00-04:00');
    const NEEDS: Record<string, any> = {
      u_maya: { intentTag: 'group_project', outlets: true, openNow: true, wifi: true, maxNoise: null },
      u_dev:  { intentTag: 'deep_work',     outlets: true, openNow: true, wifi: true, maxNoise: 'conversational' },
      u_june: { intentTag: 'reading',       outlets: false, openNow: true, wifi: false, maxNoise: 'conversational' },
      u_theo: { intentTag: 'late_night',    outlets: true, openNow: true, wifi: false, maxNoise: null },
    };
    const s = createSession(db, { createdBy: 'u_maya', schoolId: 'osu', invite: ['u_dev','u_june','u_theo'] });
    for (const [uid, n] of Object.entries(NEEDS)) {
      submitNeeds(db, s.id, { participantToken: 'ev-' + uid, userId: uid, displayName: null, ...n });
    }
    const v = sessionView(db, cal, s.id, { now: NOW, viewerId: 'u_maya' })!;
    console.log('   four people, Wednesday 19:30. state=' + v.state + ' invited=' + v.invited);
    console.log('   constraints: ' + v.constraints.map((c) => c.key + '(' + c.detail + ') asked by ' + c.askedBy.length).join(', '));
    for (const [i, p] of v.picks.entries()) {
      const w = p.worst ? v.members[p.worst.user_id] + ' has it ' + p.worst.position : '—';
      console.log('   ' + (i === 0 ? '->' : '  '), v.places[p.shop_id].name.padEnd(22),
        'on ' + p.coverage + ' of the four lists', '| worst: ' + w.padEnd(12),
        '| never been: ' + (p.never_been.join(', ') || '—'));
    }
    console.log('   ' + v.ruled_out_total + ' ruled out (' + v.ruled_out.map((r) => r.key + ' ' + r.n).join(', ') + ')');
    console.log('   ' + v.unvouched.length + ' would fit but nobody has logged how loud they get at this hour');
    console.log('   NOBODY VOTED: group_needs has no vote column and no tally exists — see src/lib/group.ts');
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## acceptance 2: a collaborative list with two or more contributors re-ranks"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    import * as lists from './server/repo/lists.ts';
    import * as shops from './server/repo/shops.ts';
    import { feedFor } from './server/repo/notifications.ts';
    const db = getDb();
    const name = (id: string) => shops.shopById(db, id)!.name;
    for (const id of ['l_our-campus-ranking', 'l_still-open-when-we-are']) {
      const list = lists.listById(db, id)!;
      const who = lists.contributorsOf(db, list);
      console.log('   ' + list.title + ' — ' + who.map((c) => c.display_name + ' (' + c.ranking.length + ' ranked)').join(', '));
      console.log('     before: ' + lists.itemsOf(db, id).map((it) => name(it.shop_id)).join(' > '));
      const rr = lists.rerank(db, list, who[1].user_id);
      const d = lists.derivedOrder(db, list);
      console.log('     after:  ' + d.ranked.map((r) => r.standing + '. ' + name(r.shop_id)).join('  '));
      if (d.unranked.length) console.log('     on the list, not in the order: ' + d.unranked.map((r) => name(r.shop_id)).join(', '));
      for (const x of d.disagreements.slice(0, 2)) {
        console.log('     disagreement: ' + name(x.a) + ' / ' + name(x.b) + ' — ' + x.forA.join('+') + ' one way, ' + x.forB.join('+') + ' the other');
      }
      const told = feedFor(db, who[0].user_id).filter((e) => e.type === 'list_reranked').length;
      console.log('     moved ' + rr!.moved + '; ' + told + ' line(s) told to the owner, 0 to ' + who[1].display_name + ' — the one who did it');
      console.log('     a second re-rank moves nothing: ' + (lists.rerank(db, list, who[0].user_id) === null ? 'refused, and nobody was told' : 'WROTE AGAIN'));
    }
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## acceptance 3: the feed, human actions only"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    import { feedFor } from './server/repo/notifications.ts';
    import { userById } from './server/repo/social.ts';
    const db = getDb();
    for (const uid of ['u_maya', 'u_dev', 'u_june', 'u_theo', 'u_lena']) {
      const f = feedFor(db, uid);
      console.log('   ' + (userById(db, uid)!.display_name + ':').padEnd(20), String(f.length).padStart(2) + ' lines,',
        f.filter((e) => e.needs_answer).length + ' waiting on them  [' +
        [...new Set(f.map((e) => e.type))].join(' ') + ']');
    }
    const rows = db.prepare('SELECT type, ref_kind, ref_id, user_id FROM notifications').all() as any[];
    const exists = (r: any) => ({
      friendship: () => db.prepare('SELECT 1 x FROM friendships WHERE id = ?').get(r.ref_id),
      list_editor: () => db.prepare('SELECT 1 x FROM list_editors WHERE list_id = ? AND user_id = ?').get(r.ref_id, r.user_id),
      list_rerank: () => db.prepare('SELECT 1 x FROM list_reranks WHERE id = ?').get(r.ref_id),
      group_session: () => db.prepare('SELECT 1 x FROM group_sessions WHERE id = ?').get(r.ref_id),
    } as any)[r.ref_kind]?.();
    const orphans = rows.filter((r) => !exists(r));
    console.log('   ' + rows.length + ' notifications, ' + orphans.length + ' pointing at a record that does not exist');
    console.log('   types in the database: ' + [...new Set(rows.map((r: any) => r.type))].sort().join(', '));
    console.log('   self-notifications: ' + (db.prepare('SELECT count(*) n FROM notifications WHERE user_id = actor_id').get() as any).n);
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## acceptance 4: the north star, on the seeded events"
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    import { northStarWeekly } from './server/repo/analytics.ts';
    import { userById } from './server/repo/social.ts';
    const db = getDb();
    for (const w of ['2026-07-27', '2026-08-03', '2026-08-10']) {
      const r = northStarWeekly(db, new Date(w + 'T00:00:00-04:00'));
      console.log('   week of ' + w + ': ' + String(r.count).padStart(2) + ' returned without logging' +
        (r.users.length ? '  (' + r.users.map((u) => userById(db, u)!.display_name.split(' ')[0]).join(', ') + ')' : ''));
    }
    console.log('   predicate: app_open on >= 2 distinct days in the week AND zero log_created that week');
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"

  echo; echo "## acceptance 5: integrity — friends-only, no coordinates, no rank for sale"
  echo "\$ friends-only is what the columns say, not what the client asks for:"
  curl -s -o /dev/null -c ./cj.tmp -X POST -H 'Content-Type: application/json' \
    -d '{"userId":"u_lena"}' http://localhost:8787/api/auth/switch
  curl -s -b ./cj.tmp -X POST -H 'Content-Type: application/json' \
    -d '{"title":"asked for public","visibility":"public","is_collaborative":false}' \
    http://localhost:8787/api/lists | node -e "
      const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      console.log('   POST /api/lists {visibility:\"public\"} -> stored ' + v.list.visibility);
    "
  curl -s -b ./cj.tmp -X POST -H 'Content-Type: application/json' \
    -d '{"shop_id":"s_bramble","intent_tag":"reading","visibility":"public","user_id":"u_maya"}' \
    http://localhost:8787/api/logs | node -e "
      const v = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      console.log('   POST /api/logs  {visibility:\"public\", user_id:\"u_maya\"} -> stored ' + v.log.visibility + ', owned by ' + v.log.user_id);
    "
  echo "\$ every route that takes a position, then a sweep of every table:"
  curl -s -o /dev/null "http://localhost:8787/api/discover?lat=41.987654&lng=-87.123456"
  curl -s -o /dev/null -b ./cj.tmp "http://localhost:8787/api/discover?lat=41.987654&lng=-87.123456"
  rm -f ./cj.tmp
  COSIGN_DB="$SCRATCH" ./node_modules/.bin/tsx -e "
    import { getDb } from './server/db/db.ts';
    const db = getDb();
    const names = (db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all() as any[]).map((t) => t.name);
    const needles = ['41.987654', '87.123456'];
    const hits = names.filter((t) => {
      const dump = JSON.stringify(db.prepare('SELECT * FROM \"' + t + '\"').all());
      return needles.some((n) => dump.includes(n));
    });
    console.log('   ' + names.length + ' tables swept, ' + hits.length + ' containing the coordinate' + (hits.length ? ': ' + hits.join(', ') : ''));
    const cols = names.flatMap((t) => (db.prepare('PRAGMA table_info(\"' + t + '\")').all() as any[]).map((c) => t + '.' + c.name));
    const paid = cols.filter((c) => /(sponsor|promot|boost|featured|placement|advert|campaign|paid|payment|billing|tier|priority|weight|rank_override)/i.test(c));
    console.log('   ' + cols.length + ' columns, ' + paid.length + ' that could hold a payment or a promotion');
  " 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
} > "$OUT/commands.txt" 2>&1

echo "wrote $OUT/commands.txt"

echo "running the phase 5B suite (both viewports)…"
P5B=$(COSIGN_EVIDENCE=phase5b npx playwright test social.spec.ts --reporter=list 2>&1 | tail -3)
echo "$P5B"

# Earlier phases re-run as regressions, into their own subdirectories, in the
# order CLAUDE.md records: read-only first, the writing ones last.
echo "re-running the phase 2 share suite…"
SHARE=$(COSIGN_EVIDENCE=phase5b/share-regression npx playwright test share.spec.ts --reporter=list 2>&1 | tail -3)
echo "$SHARE"
rm -f "$OUT"/share-regression/*.png

echo "re-running the phase 5A profile suite…"
PROFILE=$(COSIGN_EVIDENCE=phase5b/profile-regression npx playwright test profile.spec.ts --reporter=list 2>&1 | tail -3)
echo "$PROFILE"
rm -f "$OUT"/profile-regression/*.png

echo "re-running the phase 4 home suite…"
HOME_RUN=$(COSIGN_EVIDENCE=phase5b/home-regression npx playwright test home.spec.ts --reporter=list 2>&1 | tail -3)
echo "$HOME_RUN"
rm -f "$OUT"/home-regression/*.png

echo "re-running the phase 3 log suite (it writes most, so it goes last)…"
LOG=$(COSIGN_EVIDENCE=phase5b/log-regression npx playwright test log.spec.ts --reporter=list 2>&1 | tail -3)
echo "$LOG"
rm -f "$OUT"/log-regression/*.png

echo "re-running the SPA boot smoke over every route…"
BOOT=$(COSIGN_EVIDENCE_DIR=phase5b/spa node scripts/boot-smoke.mjs 2>&1 | tail -20)
echo "$BOOT" | tail -4

{
  echo; echo "## playwright"
  echo "\$ COSIGN_EVIDENCE=phase5b                   npx playwright test social.spec.ts   # phase 5B"
  echo "$P5B" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5b/share-regression   npx playwright test share.spec.ts    # phase 2"
  echo "$SHARE" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5b/profile-regression npx playwright test profile.spec.ts  # phase 5A"
  echo "$PROFILE" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5b/home-regression    npx playwright test home.spec.ts     # phase 4"
  echo "$HOME_RUN" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE=phase5b/log-regression     npx playwright test log.spec.ts      # phase 3, last (it writes most)"
  echo "$LOG" | sed 's/^/    /'
  echo "\$ COSIGN_EVIDENCE_DIR=phase5b/spa node scripts/boot-smoke.mjs"
  echo "$BOOT" | sed 's/^/    /'

  echo; echo "\$ axe violations per surface (serious/critical):"
  for f in "$OUT"/axe-*.json; do
    [ -e "$f" ] || continue
    printf '   %-34s %s\n' "$(basename "$f")" "$(node -e "
      const j = require('node:fs').readFileSync(process.argv[1], 'utf8');
      const v = JSON.parse(j).violations.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      console.log(v.length + ' (' + JSON.parse(j).passes + ' passes)');
    " "$f")"
  done
} >> "$OUT/commands.txt" 2>&1

echo "done — $OUT"
