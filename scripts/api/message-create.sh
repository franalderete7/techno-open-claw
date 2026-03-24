#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
JSON_FILE="${1:-}"
if [[ -z "$JSON_FILE" || ! -f "$JSON_FILE" ]]; then
  echo "Usage: $0 <json-file>" >&2
  exit 1
fi
api_call POST "/v1/messages" "$JSON_FILE"
