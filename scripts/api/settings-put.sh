#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
SETTING_KEY="${1:-}"
JSON_FILE="${2:-}"
if [[ -z "$SETTING_KEY" || -z "$JSON_FILE" || ! -f "$JSON_FILE" ]]; then
  echo "Usage: $0 <setting-key> <json-file>" >&2
  exit 1
fi
api_call PUT "/v1/settings/$SETTING_KEY" "$JSON_FILE"
