#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
STOCK_UNIT_ID="${1:-}"
JSON_FILE="${2:-}"
if [[ -z "$STOCK_UNIT_ID" || -z "$JSON_FILE" || ! -f "$JSON_FILE" ]]; then
  echo "Usage: $0 <stock-unit-id> <json-file>" >&2
  exit 1
fi
api_call PATCH "/v1/stock/$STOCK_UNIT_ID" "$JSON_FILE"
