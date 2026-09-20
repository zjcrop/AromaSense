#!/usr/bin/env bash
set -euo pipefail

: "${AKD_TASK_JSON:?AKD_TASK_JSON is required}"

if ! command -v copilot >/dev/null 2>&1; then
  echo "copilot CLI is required" >&2
  exit 2
fi

prompt_file="$(mktemp)"
trap 'rm -f "$prompt_file"' EXIT

cat >"$prompt_file" <<'EOF'
You are the implementation backend for Auto Keep Doing (AKD).

Implement the requested repository change from the AKD task JSON below.

Rules:
- Work only inside the current repository checkout.
- Preserve existing architecture and repository instructions.
- Do not push, merge, open pull requests, or modify GitHub settings.
- Do not read or print secrets.
- Do not disable tests, weaken assertions, or remove validation to make checks pass.
- Prefer the smallest coherent implementation that satisfies the supplied requirements.
- Inspect relevant code before editing.
- You may run local repository tests or static checks when useful.
- Leave all implementation changes in the working tree for the outer AKD executor to inspect and commit.
- If the task cannot be completed safely from the available repository context, exit without fabricating changes and explain why.

AKD task JSON:
EOF

printf '%s
' "$AKD_TASK_JSON" >>"$prompt_file"

before="$(git status --porcelain=v1)"
copilot   -p "$(cat "$prompt_file")"   -s   --no-ask-user   --allow-tool='read'   --allow-tool='write'   --allow-tool='shell(git:*)'   --allow-tool='shell(npm:*)'   --allow-tool='shell(npx:*)'   --allow-tool='shell(node:*)'   --allow-tool='shell(python:*)'   --allow-tool='shell(python3:*)'   --deny-tool='shell(git push)'   --deny-tool='shell(git merge)'   --deny-tool='shell(git rebase)'   --deny-tool='shell(git reset:*)'   --deny-tool='shell(gh:*)'

after="$(git status --porcelain=v1)"
if [ "$before" = "$after" ]; then
  echo "Copilot completed without producing repository changes." >&2
  exit 3
fi
