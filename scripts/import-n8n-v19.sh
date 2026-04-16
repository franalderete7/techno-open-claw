#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_DIR="${N8N_WORKFLOW_DIR:-$ROOT_DIR/n8n/v19}"
CONTAINER_NAME="${N8N_CONTAINER_NAME:-}"
CONTAINER_TMP_DIR="${N8N_CONTAINER_TMP_DIR:-/tmp/techno-open-claw-n8n-v19}"

if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "Workflow directory not found: $WORKFLOW_DIR" >&2
  exit 1
fi

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

N8N_CONTAINER="$(find_n8n_container)"

echo "Using n8n container: $N8N_CONTAINER"
echo "Workflow source dir: $WORKFLOW_DIR"

docker exec "$N8N_CONTAINER" sh -lc "rm -rf '$CONTAINER_TMP_DIR' && mkdir -p '$CONTAINER_TMP_DIR'"

for workflow_file in "$WORKFLOW_DIR"/TechnoStore_v19_*.json; do
  if [[ ! -f "$workflow_file" ]]; then
    echo "No v19 workflow JSON files found in $WORKFLOW_DIR" >&2
    exit 1
  fi

  echo "Copying $(basename "$workflow_file")"
  docker cp "$workflow_file" "$N8N_CONTAINER:$CONTAINER_TMP_DIR/"
done

echo "Importing workflows via n8n CLI..."
docker exec "$N8N_CONTAINER" sh -lc "n8n import:workflow --separate --input='$CONTAINER_TMP_DIR'"

echo
echo "Imported workflows:"
docker exec "$N8N_CONTAINER" sh -lc "ls -1 '$CONTAINER_TMP_DIR' | sed 's/^/ - /'"

echo
echo "Next:"
echo "1. Open n8n, publish TechnoStore - AI Sales Agent v19 (catálogo), and point ManyChat to webhook techno-sales-v19."
echo "2. Deploy API with p_full_catalog support (v17_build_turn_context) before going live."
echo "3. Confirm OPENCLAW_API_* env vars and ManyChat / Groq credentials in n8n."
