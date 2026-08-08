#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/copilot"
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8001 --app-dir src
