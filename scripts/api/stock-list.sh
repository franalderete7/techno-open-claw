#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
LIMIT="${1:-50}"
api_call GET "/v1/stock?limit=$LIMIT"
