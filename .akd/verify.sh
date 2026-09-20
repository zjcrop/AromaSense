#!/usr/bin/env bash
set -euo pipefail

if [ -x .akd/project-verify.sh ]; then
  exec .akd/project-verify.sh
fi

if [ -f package.json ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi

  if node -e 'const p=require("./package.json");process.exit(p.scripts?.check?0:1)'; then
    exec npm run check
  fi
  if node -e 'const p=require("./package.json");process.exit(p.scripts?.test?0:1)'; then
    exec npm test
  fi
fi

if [ -x ./gradlew ]; then
  exec ./gradlew test
fi

echo "No project verification command found. Add executable .akd/project-verify.sh." >&2
exit 2
