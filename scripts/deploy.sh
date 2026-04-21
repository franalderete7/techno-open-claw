#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

docker compose up -d postgres
docker compose run --rm migrate
docker compose build api web
docker compose up -d api web

echo "Deploy complete."
