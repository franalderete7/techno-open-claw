#!/usr/bin/env bash
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"
api_call GET "/v1/settings"
echo
