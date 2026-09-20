#!/usr/bin/env bash
set -euo pipefail

level="$(echo "${AKD_TASK_JSON:?AKD_TASK_JSON is required}" | jq -r '.task.verificationLevel // "T1"')"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

case "$level" in
  T0)
    npm run typecheck
    ;;
  T1|T2)
    npm run check
    ;;
  T3|T4)
    npm run check
    npm run bundle:web
    ;;
  *)
    echo "Unknown AKD verification level: $level" >&2
    exit 2
    ;;
esac
