#!/bin/bash
# setup.sh -- One-time setup for PR Teams Notifier
# Run from Git Bash: bash setup.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== PR Teams Notifier Setup ==="
echo ""

# Step 1: Check prerequisites
echo "[1/3] Checking prerequisites..."

MISSING=0
command -v gh >/dev/null 2>&1 || { echo "  MISSING: gh (GitHub CLI) - Install from https://cli.github.com"; MISSING=1; }
command -v node >/dev/null 2>&1 || { echo "  MISSING: node - Install from https://nodejs.org"; MISSING=1; }
command -v git >/dev/null 2>&1 || { echo "  MISSING: git - Install from https://git-scm.com"; MISSING=1; }

if [ $MISSING -eq 1 ]; then
  echo ""
  echo "Please install the missing tools and run this script again."
  exit 1
fi

echo "  gh:   $(gh --version | head -1)"
echo "  node: $(node --version)"
echo "  git:  $(git --version)"
echo "  All prerequisites found."

# Step 2: Configure Teams webhook URL
echo ""
echo "[2/3] Checking Teams webhook configuration..."

if [ -f "$SCRIPT_DIR/config.json" ]; then
  CURRENT_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$SCRIPT_DIR/config.json','utf-8')).teamsWebhookUrl || '')" 2>/dev/null)

  if [ "$CURRENT_URL" = "YOUR_TEAMS_WEBHOOK_URL_HERE" ] || [ -z "$CURRENT_URL" ]; then
    echo "  Webhook URL not yet configured."
    echo ""
    echo "  To get a webhook URL:"
    echo "    1. Open Microsoft Teams"
    echo "    2. Go to the channel where you want notifications"
    echo "    3. Click '+' > search 'Workflows' > 'Post to a channel when a webhook request is received'"
    echo "    4. Follow the prompts to create the workflow"
    echo "    5. Copy the webhook URL"
    echo ""
    read -p "  Paste your Teams webhook URL (or press Enter to skip): " WEBHOOK_URL

    if [ -n "$WEBHOOK_URL" ]; then
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$SCRIPT_DIR/config.json','utf-8'));
        cfg.teamsWebhookUrl = process.argv[1];
        fs.writeFileSync('$SCRIPT_DIR/config.json', JSON.stringify(cfg, null, 2));
      " "$WEBHOOK_URL"
      echo "  Webhook URL saved to config.json."
    else
      echo "  Skipped. Edit config.json later to add your webhook URL."
    fi
  else
    echo "  Webhook URL already configured."
  fi
else
  echo "  config.json not found. Copying from config.example.json..."
  cp "$SCRIPT_DIR/config.example.json" "$SCRIPT_DIR/config.json"
  echo "  Created config.json. Edit it to add your Teams webhook URL."
fi

# Step 3: Set up gh alias
echo ""
echo "[3/3] Setting up gh alias 'pr-notify'..."

# Convert path for cross-platform compatibility
NOTIFY_PATH="$SCRIPT_DIR/gh-pr-notify.sh"
gh alias set pr-notify --shell "\"$NOTIFY_PATH\" \"\$@\"" --clobber 2>/dev/null

if [ $? -eq 0 ]; then
  echo "  Alias 'pr-notify' created successfully."
else
  echo "  Warning: Could not create gh alias. You can set it manually:"
  echo "  gh alias set pr-notify --shell '$NOTIFY_PATH \"\$@\"'"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage (instead of 'gh pr create'):"
echo "  gh pr-notify -t \"My PR title\" -b \"Description of changes\""
echo ""
echo "The Teams notification is sent automatically after the PR is created."
echo ""

if [ "$CURRENT_URL" = "YOUR_TEAMS_WEBHOOK_URL_HERE" ] || [ -z "$CURRENT_URL" ]; then
  echo "REMINDER: Don't forget to add your Teams webhook URL to config.json!"
  echo ""
fi
