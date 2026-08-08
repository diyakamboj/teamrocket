#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
