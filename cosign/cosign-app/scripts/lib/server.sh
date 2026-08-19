#!/usr/bin/env bash
# The server lifecycle every evidence script needs, in one place. Sourced from
# cosign-app/ after the script has cd'd there, never run on its own:
#
#   . scripts/lib/server.sh
#
# Each of the six scripts stands the built app on :8787, waits for it, and
# stops it again. That was five hand-written copies of the same three steps,
# and one of the three steps was wrong in four of them.

# `kill $!` on `npm run …` kills the npm wrapper, returns 0, and leaves the
# node process npm spawned still holding the port. Phases 2 through 5A each
# claimed to clean up after themselves and each left a listener on :8787: the
# next evidence run's preflight catches that loudly, but an ad-hoc
# `npx playwright test` silently measures the stale server and the previous
# build. So kill the wrapper (so it does not linger as an orphan) and then
# whatever actually owns the port.
#
# It must also not RETURN until the port is genuinely free, and that is not
# fussiness. `powershell -NoProfile` takes the better part of a second to
# start; if the trap returns before the kill lands, the next script in the same
# shell can seed, build and stand its own server on that port inside the
# window — and the kill then arrives and takes out the NEW server. That
# happened twice on 2026-08-18: once it made seven social.spec tests fail with
# ECONNREFUSED and read exactly like a code regression, and once it killed a
# gate run's server whose own log showed a clean start and no error at all.
stop_server() {
  kill "$1" 2>/dev/null
  shift
  for port in "$@"; do
    powershell -NoProfile -Command \
      "Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" \
      >/dev/null 2>&1
    # Wait for it to be gone rather than assuming it is. Ten seconds is far
    # longer than the kill has ever taken, and still bounded.
    for _ in $(seq 1 20); do
      curl -s -o /dev/null --max-time 1 "http://localhost:$port/api/meta" || break
      sleep 0.5
    done
  done
}

# Only one process may own the port. A second `npm run serve:prod` dies on
# EADDRINUSE and *looks* like it started, while the stale server keeps
# answering every check that follows — refuse to start rather than measure
# somebody else's build.
require_free_port() {
  if curl -s -o /dev/null --max-time 2 "http://localhost:$1/api/meta"; then
    echo "Something is already listening on :$1 — stop it first." >&2
    echo "  PowerShell: Get-NetTCPConnection -LocalPort $1 -State Listen" >&2
    exit 1
  fi
}

# Returns non-zero if the server never answered, so the caller can print its
# log and stop. The scripts used to fall through the wait loop unconditionally
# and produce a transcript full of empty curl output instead.
wait_for_port() {
  for _ in $(seq 1 "${2:-60}"); do
    curl -s -o /dev/null --max-time 1 "http://localhost:$1/api/meta" && return 0
    sleep 0.5
  done
  return 1
}
