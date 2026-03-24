#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
QUERY="${1:-}"
LIMIT="${2:-50}"
PATH_SUFFIX="/v1/products?limit=$LIMIT"
if [[ -n "$QUERY" ]]; then
  ENCODED_QUERY="${QUERY// /%20}"
  PATH_SUFFIX="$PATH_SUFFIX&q=$ENCODED_QUERY"
fi
api_call GET "$PATH_SUFFIX"
