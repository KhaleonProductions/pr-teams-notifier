#!/bin/bash
# gh-pr-notify.sh
# Wrapper that creates a PR and then sends a Teams notification.
# Usage: gh pr-notify [all normal gh pr create flags]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Pass all arguments to the real gh pr create and capture output
PR_OUTPUT=$(gh pr create "$@" 2>&1)
PR_EXIT_CODE=$?

# Always show the original output to the user
echo "$PR_OUTPUT"

# If pr create failed, exit without notifying
if [ $PR_EXIT_CODE -ne 0 ]; then
  exit $PR_EXIT_CODE
fi

# Extract the PR URL from the output
PR_URL=$(echo "$PR_OUTPUT" | grep -oE 'https://github\.com/[^ ]+/pull/[0-9]+' | head -1)

if [ -z "$PR_URL" ]; then
  echo "[pr-notify] Could not extract PR URL. Skipping notification."
  exit 0
fi

echo "[pr-notify] Sending Teams notification..."

# Fetch full PR details as JSON (single API call)
PR_JSON=$(gh pr view "$PR_URL" --json url,title,body,headRefName,baseRefName,files,changedFiles,additions,deletions,createdAt,number 2>/dev/null)

if [ -z "$PR_JSON" ]; then
  echo "[pr-notify] Could not fetch PR details. Skipping notification."
  exit 0
fi

# Derive repo name from URL
PR_REPO=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/.*|\1|')

# Run the notification script
export PR_JSON
export PR_REPO
export PR_URL
node "$SCRIPT_DIR/notify.js"

echo "[pr-notify] Done."
