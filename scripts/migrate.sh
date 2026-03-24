#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

for file in "$ROOT_DIR"/db/migrations/*.sql; do
  echo "Applying $(basename "$file")"
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f - < "$file"
done

echo "Migrations applied."
