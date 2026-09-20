#!/usr/bin/env bash
set -euo pipefail

: "${AKD_TASK_KIND:?AKD_TASK_KIND is required}"
: "${AKD_TASK_ID:?AKD_TASK_ID is required}"
: "${AKD_PROJECT_ID:?AKD_PROJECT_ID is required}"
: "${AKD_TASK_JSON:?AKD_TASK_JSON is required}"

sanitize() {
  printf '%s' "$1" | tr -cs 'A-Za-z0-9._-' '-'
}

change_set_id="$(echo "$AKD_TASK_JSON" | jq -r '.changeSet.changeSetId')"
AKD_WORK_BRANCH="akd/$(sanitize "$AKD_PROJECT_ID")/$(sanitize "$change_set_id")"
export AKD_WORK_BRANCH
export AKD_BASE_BRANCH="${AKD_BASE_BRANCH:-main}"

git config user.name "${AKD_GIT_AUTHOR_NAME:-auto-keep-doing[bot]}"
git config user.email "${AKD_GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"

if git ls-remote --exit-code --heads origin "$AKD_WORK_BRANCH" >/dev/null 2>&1; then
  git fetch origin "$AKD_WORK_BRANCH:$AKD_WORK_BRANCH"
  git switch "$AKD_WORK_BRANCH"
else
  git switch -c "$AKD_WORK_BRANCH" "origin/$AKD_BASE_BRANCH"
fi

case "$AKD_TASK_KIND" in
  IMPLEMENT)
    .akd/implement.sh

    if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
      echo "IMPLEMENT task produced no changes." >&2
      exit 3
    fi

    git add -A
    git commit -m "AKD implement $change_set_id"
    git push --set-upstream origin "$AKD_WORK_BRANCH"
    ;;

  VERIFY)
    .akd/verify.sh
    ;;

  DELIVER)
    .akd/deliver.sh
    ;;

  *)
    echo "Unsupported AKD_TASK_KIND: $AKD_TASK_KIND" >&2
    exit 2
    ;;
esac
