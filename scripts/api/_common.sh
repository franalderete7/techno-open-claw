#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TECHNO_OPEN_CLAW_ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

API_BASE_URL="${TECHNO_OPEN_CLAW_API_URL:-http://127.0.0.1:${API_PORT:-4000}}"
API_TOKEN="${TECHNO_OPEN_CLAW_API_TOKEN:-${API_BEARER_TOKEN:-}}"
ACTOR_TYPE="${TECHNO_OPEN_CLAW_ACTOR_TYPE:-agent}"
ACTOR_ID="${TECHNO_OPEN_CLAW_ACTOR_ID:-openclaw}"

if [[ -z "$API_TOKEN" ]]; then
  echo "Missing API token. Set API_BEARER_TOKEN in .env or TECHNO_OPEN_CLAW_API_TOKEN in the environment." >&2
  exit 1
fi

api_call() {
  local method="$1"
  local path="$2"
  local body_file="${3:-}"

  if [[ -n "$body_file" ]]; then
    curl -fsS -X "$method" "$API_BASE_URL$path" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" \
      -H "x-actor-type: $ACTOR_TYPE" \
      -H "x-actor-id: $ACTOR_ID" \
      --data-binary "@$body_file"
  else
    curl -fsS -X "$method" "$API_BASE_URL$path" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "x-actor-type: $ACTOR_TYPE" \
      -H "x-actor-id: $ACTOR_ID"
  fi
}
