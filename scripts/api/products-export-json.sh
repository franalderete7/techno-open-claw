#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

OUTPUT_FILE="${1:-/tmp/technostore-products.json}"
LIMIT="${2:-200}"
ACTIVE="${3:-true}"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "Limit must be a positive integer." >&2
  exit 1
fi

if [[ "$LIMIT" -lt 1 || "$LIMIT" -gt 200 ]]; then
  echo "Limit must be between 1 and 200. The current API caps product list responses at 200." >&2
  exit 1
fi

if [[ "$ACTIVE" != "true" && "$ACTIVE" != "false" ]]; then
  echo "Active flag must be 'true' or 'false'." >&2
  exit 1
fi

PATH_SUFFIX="/v1/products?limit=$LIMIT&active=$ACTIVE"

api_call GET "$PATH_SUFFIX" > "$OUTPUT_FILE"

echo "Saved products JSON to $OUTPUT_FILE"
