#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_DIR="${N8N_WORKFLOW_DIR:-$ROOT_DIR/n8n/telegram}"
CONTAINER_NAME="${N8N_CONTAINER_NAME:-}"
CONTAINER_TMP_DIR="${N8N_CONTAINER_TMP_DIR:-/tmp/techno-open-claw-n8n-telegram}"

find_n8n_container() {
  if [[ -n "$CONTAINER_NAME" ]]; then
    echo "$CONTAINER_NAME"
    return 0
  fi

  local detected
  detected="$(docker ps --format '{{.Names}}' | grep -E '(^|[-_])n8n([_-]|$)' | head -n 1 || true)"

  if [[ -z "$detected" ]]; then
    echo "Could not detect an n8n container. Set N8N_CONTAINER_NAME and rerun." >&2
    exit 1
  fi

  echo "$detected"
}

WORKFLOW_FILE="$WORKFLOW_DIR/TechnoStore_Telegram_Operator_v1.json"

if [[ ! -f "$WORKFLOW_FILE" ]]; then
  echo "Workflow file not found: $WORKFLOW_FILE" >&2
  exit 1
fi

N8N_CONTAINER="$(find_n8n_container)"

echo "Using n8n container: $N8N_CONTAINER"
docker exec "$N8N_CONTAINER" sh -lc "rm -rf '$CONTAINER_TMP_DIR' && mkdir -p '$CONTAINER_TMP_DIR'"
docker cp "$WORKFLOW_FILE" "$N8N_CONTAINER:$CONTAINER_TMP_DIR/"
docker exec "$N8N_CONTAINER" sh -lc "n8n import:workflow --input='$CONTAINER_TMP_DIR/$(basename "$WORKFLOW_FILE")'"

echo
echo "Imported Telegram operator workflow:"
echo " - $(basename "$WORKFLOW_FILE")"
