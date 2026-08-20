#!/usr/bin/env bash
# Start both servers and keep them running until you press Ctrl-C.
#
# The backend must be up before the frontend is useful: Vite proxies /api to
# localhost:8000, so a stopped backend shows up as ECONNREFUSED on every
# request rather than as an obvious "server not running" message.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "No backend virtualenv found. Create it first:" >&2
  echo "  cd $ROOT/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

port_in_use() { lsof -ti:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Reclaim a port held by *this repo's own* leftover dev server.
#
# Ctrl-C does not always reap the servers (a detached npm run, a crashed
# shell), so the common case for a busy port is our own stale process and
# telling the user to go kill it by hand is busywork. What we must not do is
# kill whatever happens to hold the port -- someone else's server on 8080 is
# not ours to stop -- so a process is only reclaimed when both its command
# line and its working directory place it inside this checkout.
reclaim_port() {
  local port="$1" pid cmd cwd
  pid="$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null | head -1)" || true
  [ -n "$pid" ] || return 0

  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"

  case "$cwd" in
    "$ROOT"|"$ROOT"/*) ;;
    *) return 1 ;;                       # not running from this checkout
  esac
  case "$cmd" in
    *vite*|*"uvicorn app.main:app"*) ;;
    *) return 1 ;;                       # not a dev server we start
  esac

  echo "reclaiming :$port from our own stale dev server (pid $pid)"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    port_in_use "$port" || return 0
    sleep 0.25
  done
  kill -9 "$pid" 2>/dev/null || true     # ignored SIGTERM; insist
  for _ in $(seq 1 20); do
    port_in_use "$port" || return 0
    sleep 0.25
  done
  return 1
}

for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if port_in_use "$port"; then
    if ! reclaim_port "$port"; then
      echo "Port $port is held by something that is not one of our dev servers." >&2
      echo "Check what it is, then stop it:" >&2
      echo "  lsof -i:$port" >&2
      echo "  kill \$(lsof -ti:$port)" >&2
      exit 1
    fi
  fi
done

cleanup() {
  echo
  echo "stopping…"
  # Kill the whole process group so uvicorn's reloader child goes too.
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "starting backend on :$BACKEND_PORT"
(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --reload --port "$BACKEND_PORT") &
BACKEND_PID=$!

# Wait for it to answer before starting the UI, so the first page load does
# not fire requests at a port nothing is listening on yet.
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$BACKEND_PORT/health" && break
  sleep 1
done
curl -sf -o /dev/null "http://127.0.0.1:$BACKEND_PORT/health" \
  || { echo "backend failed to start — see the output above" >&2; exit 1; }
echo "backend ready"

echo "starting frontend on :$FRONTEND_PORT"
(cd "$ROOT/frontend" && npm run dev -- --port "$FRONTEND_PORT") &
FRONTEND_PID=$!

echo
echo "  app      http://localhost:$FRONTEND_PORT"
echo "  api docs http://localhost:$BACKEND_PORT/docs"
echo "  Ctrl-C stops both."
echo

wait
