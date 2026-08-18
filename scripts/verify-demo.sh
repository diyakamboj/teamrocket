#!/usr/bin/env bash
# Pre-demo checklist: API, ranking, Copilot, optional Azure/CWYD.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API_BASE_URL:-http://localhost:8000}"
UI="${UI_BASE_URL:-http://localhost:8080}"
PY="${PYTHON:-python3}"
if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
  PY="$ROOT/backend/.venv/bin/python"
elif [[ -x /Users/shaikmohammadfardeen/Documents/anaconda/anaconda3/bin/python ]]; then
  PY="/Users/shaikmohammadfardeen/Documents/anaconda/anaconda3/bin/python"
fi

fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "OK   $*"; }

curl -fsS "$API/health" >/dev/null || fail "API health at $API/health"
ok "API health"

STATUS="$(curl -fsS "$API/api/agent/status")"
echo "$STATUS" | "$PY" -c "import json,sys; d=json.load(sys.stdin); print('agent', d)" >/dev/null
ok "Copilot status endpoint"

JOB_ID=""
if [[ -f "$ROOT/demo/.last-job-id" ]]; then
  JOB_ID="$(cat "$ROOT/demo/.last-job-id")"
fi
if [[ -z "$JOB_ID" ]]; then
  JOBS="$(curl -fsS -H "X-Recruiter-Email: recruiter@example.com" "$API/api/jobs")"
  JOB_ID="$(echo "$JOBS" | "$PY" -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')")"
fi
[[ -n "$JOB_ID" ]] || fail "No job in API. Run: $PY backend/scripts/seed_demo.py --api $API"
ok "Job $JOB_ID"

RANK="$(curl -fsS -H "X-Recruiter-Email: recruiter@example.com" "$API/api/candidates/rank?job_id=$JOB_ID")"
echo "$RANK" | "$PY" -c "
import json,sys
rows=json.load(sys.stdin)
assert rows, 'empty ranking'
top=(rows[0].get('name') or rows[0].get('candidate_name') or '')
print(top)
assert 'Alice' in top, f'expected Alice first, got {top!r}'
"
ok "Ranking: Alice is #1"

ASK="$(curl -fsS -H "Content-Type: application/json" -H "X-Recruiter-Email: recruiter@example.com" \
  -d "{\"query\":\"Who meets every must-have skill?\",\"job_id\":\"$JOB_ID\"}" \
  "$API/api/agent/ask")"
echo "$ASK" | "$PY" -c "
import json,sys
d=json.load(sys.stdin)
text=d.get('response') or d.get('answer') or ''
assert len(text) > 20, 'empty Copilot response'
print((d.get('tool_used') or 'tool'), 'chars', len(text))
"
ok "Copilot ask"

if curl -fsS "$UI" >/dev/null; then
  ok "Frontend $UI"
else
  echo "WARN frontend not reachable at $UI"
fi

CHATBOT="$(echo "$STATUS" | "$PY" -c "import json,sys; d=json.load(sys.stdin); print((d.get('chatbot') or {}).get('reachable'))")"
if [[ "$CHATBOT" == "True" || "$CHATBOT" == "true" ]]; then
  ok "CWYD chatbot reachable"
else
  echo "WARN CWYD not reachable — Copilot will use the local agent (backup path)"
fi

if [[ "${CHECK_AZURE:-0}" == "1" ]]; then
  MOCK="$(echo "$STATUS" | "$PY" -c "import json,sys; d=json.load(sys.stdin); print(d.get('azure_mock') or d.get('use_mock_azure') or '')")"
  echo "Azure/mock flag from status: ${MOCK:-unknown}"
fi

echo
echo "Demo-critical path is ready."
echo "Open $UI → Dashboard → Backend Engineer → Rank → Copilot."
