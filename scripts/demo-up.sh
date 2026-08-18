#!/usr/bin/env bash
# Isolated demo API: frozen SQLite, mock Azure, no --reload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  if [[ -x .venv/bin/python ]]; then
    PY=".venv/bin/python"
  elif [[ -x /Users/shaikmohammadfardeen/Documents/anaconda/anaconda3/bin/python ]]; then
    PY="/Users/shaikmohammadfardeen/Documents/anaconda/anaconda3/bin/python"
  else
    PY="python3"
  fi
fi

if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 is already in use."
  echo "Stop the dev API, or seed the running server with:"
  echo "  $PY \"$ROOT/backend/scripts/seed_demo.py\" --api http://localhost:8000"
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-sqlite:///./demo_resume_assistant.db}"
export USE_MOCK_AZURE="${USE_MOCK_AZURE:-true}"
export CHATBOT_ENABLED="${CHATBOT_ENABLED:-true}"
export CHATBOT_API_URL="${CHATBOT_API_URL:-http://localhost:8001}"

echo "Seeding $DATABASE_URL (USE_MOCK_AZURE=$USE_MOCK_AZURE)"
"$PY" -u "$ROOT/backend/scripts/seed_demo.py"

echo "Starting API on http://127.0.0.1:8000 (no reload)"
exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
