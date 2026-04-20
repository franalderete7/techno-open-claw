#!/usr/bin/env bash
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <settings-key> <json-file>" >&2
  exit 1
fi
api_call PUT "/v1/settings/$1" "$2"
echo
