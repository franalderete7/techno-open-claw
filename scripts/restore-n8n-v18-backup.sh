#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-}"
CONTAINER_NAME="${N8N_CONTAINER_NAME:-}"
CONTAINER_TMP_DIR="${N8N_CONTAINER_TMP_DIR:-/tmp/techno-open-claw-n8n-v18-restore}"

if [[ -z "$BACKUP_DIR" ]]; then
  echo "Usage: ./scripts/restore-n8n-v18-backup.sh <backup-dir>" >&2
  exit 1
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Backup directory not found: $BACKUP_DIR" >&2
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
echo "Restoring backup dir: $BACKUP_DIR"

docker exec "$N8N_CONTAINER" sh -lc "rm -rf '$CONTAINER_TMP_DIR' && mkdir -p '$CONTAINER_TMP_DIR'"

shopt -s nullglob
files=("$BACKUP_DIR"/*.json)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No backup workflow JSON files found in $BACKUP_DIR" >&2
  exit 1
fi

for workflow_file in "${files[@]}"; do
  base="$(basename "$workflow_file")"
  if [[ "$base" == "manifest.json" ]]; then
    continue
  fi

  echo "Copying $base"
  docker cp "$workflow_file" "$N8N_CONTAINER:$CONTAINER_TMP_DIR/"
done

echo "Restoring workflows via n8n CLI..."
docker exec "$N8N_CONTAINER" sh -lc "n8n import:workflow --separate --input='$CONTAINER_TMP_DIR' >/dev/null"

echo
echo "Restore complete."
