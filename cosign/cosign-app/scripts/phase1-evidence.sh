#!/usr/bin/env bash
# Phase 1 acceptance evidence, captured as command output rather than claims.
#
#   cd cosign/cosign-app && bash scripts/phase1-evidence.sh
#
# Assumes the prod server is already running (npm run prod). Writes to
# evidence/phase1/ at the repo root.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="../../evidence/phase1"
mkdir -p "$OUT"

{
  echo "# Phase 1 acceptance evidence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node --version), npm $(npm --version)"

  echo; echo "## npx tsc -b (project refs: app / node / server)"
  npx tsc -b; echo "exit=$?"

  echo; echo "## npm test"
  npm test 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings" | tail -20

  echo; echo "## npm run lint"
  npm run lint 2>&1 | tail -3

  # Seeded into a scratch path so this is provably a from-nothing build and
  # so it can run while the prod server holds the real DB.
  echo; echo "## one-shot seed from a clean database (COSIGN_DB=\$TMP/cosign-evidence.db)"
  SCRATCH="$(mktemp -d)/cosign-evidence.db"
  COSIGN_DB="$SCRATCH" npm run seed 2>&1 | grep -Ev "ExperimentalWarning|trace-warnings"
  echo "exit=${PIPESTATUS[0]}"
  echo "database built at: $SCRATCH ($(wc -c < "$SCRATCH") bytes)"

  echo; echo "## prod server: SSR share page, token revocation, no auth"
  echo "\$ curl -s -o /dev/null -w '%{http_code} %{size_download}b %{time_total}s' localhost:8787/s/<active ranking token>"
  curl -s -o /dev/null -w '%{http_code} %{size_download}b %{time_total}s\n' "http://localhost:8787/s/IofpCInelhr1"
  echo "\$ curl ... /s/<revoked token>   (expect 410 tombstone, not the list)"
  curl -s -o /dev/null -w '%{http_code} %{size_download}b\n' "http://localhost:8787/s/e3lsicjJ4Q3S"
  echo "\$ curl ... /s/<profile-scoped token>  (expect 404 — wrong surface for this token)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/s/Rp7YT1i9S-Ov"
  echo "\$ curl ... /s/<unknown token>   (expect 404)"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/s/nope"
  echo "\$ curl ... /api/me  (no cookie)"
  curl -s "http://localhost:8787/api/me"; echo
} > "$OUT/commands.txt" 2>&1

# Zero external services: no key, no env var, no remote host in tracked source.
{
  echo "# Every live external-service reference in tracked source (want: none)"
  echo "# pattern: supabase|googleapis|google.maps|VITE_|lovable|@vercel|fonts.g|cdn.|unpkg|jsdelivr|api_key|SERVICE_ROLE"
  echo
  git -C ../.. grep -nIE "supabase|googleapis|google\.maps|VITE_|lovable|@vercel|fonts\.(googleapis|gstatic)|unpkg\.com|jsdelivr|api_key|SERVICE_ROLE" \
    -- 'cosign/cosign-app/src' 'cosign/cosign-app/server' 'cosign/cosign-app/seed' \
       'cosign/cosign-app/index.html' 'cosign/cosign-app/public' 'cosign/cosign-app/package.json' \
    || echo "(no matches — clean)"
  echo
  echo "# .env files present (want: none)"
  find . -maxdepth 2 -name ".env*" -not -path "./node_modules/*" || true
  echo "(none listed above = none)"
  echo
  echo "# secrets and database are ignored, never committed:"
  git -C ../.. check-ignore -v cosign/cosign-app/server/data/cookie-secret.txt cosign/cosign-app/server/data/cosign.db
} > "$OUT/zero-external-services.txt" 2>&1

echo "wrote $OUT/commands.txt and $OUT/zero-external-services.txt"
