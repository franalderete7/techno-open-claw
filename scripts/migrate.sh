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

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

echo "Waiting for postgres..."
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi

  sleep 2
done

if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" >/dev/null 2>&1; then
  echo "Postgres is not ready."
  exit 1
fi

for file in "$ROOT_DIR"/db/migrations/*.sql; do
  echo "Applying $(basename "$file")"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f - < "$file"
done

echo "Migrations applied."
