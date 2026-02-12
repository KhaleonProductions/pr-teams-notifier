#!/bin/bash
# add-to-repo.sh -- Add PR Teams notification workflow to a GitHub repo
# Usage: bash add-to-repo.sh <local-repo-path>
# Example: bash add-to-repo.sh C:/code/my-project

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ARG="$1"

if [ -z "$REPO_ARG" ]; then
  echo "Usage: bash add-to-repo.sh <local-repo-path>"
  echo ""
  echo "Examples:"
  echo "  bash add-to-repo.sh C:/code/my-project"
  echo "  bash add-to-repo.sh resume-builder-pro    (looks in C:/code/)"
  exit 1
fi

# Find the repo
if [ -d "$REPO_ARG/.git" ]; then
  REPO_PATH="$REPO_ARG"
elif [ -d "C:/code/$REPO_ARG/.git" ]; then
  REPO_PATH="C:/code/$REPO_ARG"
else
  echo "ERROR: Cannot find a git repo at '$REPO_ARG' or 'C:/code/$REPO_ARG'"
  exit 1
fi

echo "Adding PR notification workflow to: $REPO_PATH"

# Create .github/workflows directory if needed
mkdir -p "$REPO_PATH/.github/workflows"

# Copy the caller workflow
cp "$SCRIPT_DIR/caller-workflow/pr-notify.yml" "$REPO_PATH/.github/workflows/pr-notify.yml"

echo "Workflow file added: $REPO_PATH/.github/workflows/pr-notify.yml"

# Try to get repo name for the secret URL
REPO_NAME=$(cd "$REPO_PATH" && gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)

echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Commit and push the workflow file:"
echo "   cd $REPO_PATH"
echo "   git add .github/workflows/pr-notify.yml"
echo "   git commit -m \"Add PR Teams notification workflow\""
echo "   git push"
echo ""
echo "2. Add the TEAMS_WEBHOOK_URL secret on GitHub:"

if [ -n "$REPO_NAME" ]; then
  echo "   Option A (terminal):"
  echo "     gh secret set TEAMS_WEBHOOK_URL --repo $REPO_NAME"
  echo ""
  echo "   Option B (browser):"
  echo "     https://github.com/$REPO_NAME/settings/secrets/actions"
  echo "     Click 'New repository secret'"
  echo "     Name:  TEAMS_WEBHOOK_URL"
  echo "     Value: (paste your Teams webhook URL)"
else
  echo "   Go to your repo on GitHub > Settings > Secrets and variables > Actions"
  echo "   Click 'New repository secret'"
  echo "   Name:  TEAMS_WEBHOOK_URL"
  echo "   Value: (paste your Teams webhook URL)"
fi

echo ""
echo "After that, any PR opened from the GitHub web UI will also send a Teams notification."
