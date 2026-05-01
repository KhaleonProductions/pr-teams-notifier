#!/usr/bin/env bash
# bootstrap.sh — one-shot lookup of the Microsoft Graph IDs that notify.js needs
#                to post Feature Docs into a Microsoft Lists tab in a Teams channel.
#
# Run this once, after you have:
#   1. Created a SharePoint List named "Feature Docs" in the team's channel
#      (Teams → channel → + → Lists → Create a list → From scratch)
#   2. Generated a client secret for the SG1 "M365 Intelligence Pro Content"
#      Azure app registration
#
# Output: a config.json snippet you can paste into config.json.
#
# Requires: gh CLI authenticated AND the user must be a member of the target Team.

set -euo pipefail

echo "=== pr-teams-notifier — bootstrap ==="
echo
read -rp "Team display name (e.g. 'The Everything'): " TEAM_NAME
read -rp "List display name (default: 'Feature Docs'): " LIST_NAME
LIST_NAME="${LIST_NAME:-Feature Docs}"
echo

graph() {
  gh api -H 'Accept: application/json' --hostname graph.microsoft.com "$@"
}

echo "[1/3] Finding team '$TEAM_NAME' via /me/joinedTeams ..."
TEAM_JSON="$(graph /v1.0/me/joinedTeams)"
GROUP_ID="$(echo "$TEAM_JSON" | jq -r --arg name "$TEAM_NAME" '.value[] | select(.displayName == $name) | .id' | head -n1)"

if [[ -z "$GROUP_ID" || "$GROUP_ID" == "null" ]]; then
  echo "ERROR: No team named '$TEAM_NAME' found. Available teams:"
  echo "$TEAM_JSON" | jq -r '.value[].displayName' | sed 's/^/  - /'
  exit 1
fi
echo "  groupId = $GROUP_ID"
echo

echo "[2/3] Resolving SharePoint site for the team ..."
SITE_JSON="$(graph "/v1.0/groups/$GROUP_ID/sites/root")"
SITE_ID="$(echo "$SITE_JSON" | jq -r '.id')"

if [[ -z "$SITE_ID" || "$SITE_ID" == "null" ]]; then
  echo "ERROR: Could not resolve SharePoint site for the team."
  echo "$SITE_JSON" | head -20
  exit 1
fi
echo "  siteId  = $SITE_ID"
echo

echo "[3/3] Finding List '$LIST_NAME' on the site ..."
LIST_JSON="$(graph "/v1.0/sites/$SITE_ID/lists?\$filter=displayName eq '$LIST_NAME'")"
LIST_ID="$(echo "$LIST_JSON" | jq -r '.value[0].id')"

if [[ -z "$LIST_ID" || "$LIST_ID" == "null" ]]; then
  echo "ERROR: No List named '$LIST_NAME' found on this site."
  echo "Available lists on this site:"
  graph "/v1.0/sites/$SITE_ID/lists" | jq -r '.value[].displayName' | sed 's/^/  - /'
  exit 1
fi
echo "  listId  = $LIST_ID"
echo

echo "=== config.json snippet ==="
cat <<EOF
{
  "teamsWebhookUrl": "<keep your existing value>",
  "senderName":      "PR Notifier",
  "repos":           [],
  "anthropic": {
    "apiKey": "sk-ant-...",
    "model":  "claude-haiku-4-5-20251001"
  },
  "azure": {
    "tenantId":            "e5c2a9fc-8901-41cc-8e5a-d504e42e4ca0",
    "contentClientId":     "<paste from Azure Portal — M365 Intelligence Pro Content app>",
    "contentClientSecret": "<paste new secret value here>"
  },
  "lists": {
    "siteId": "$SITE_ID",
    "listId": "$LIST_ID"
  }
}
EOF
echo
echo "Done. Paste the snippet into config.json (and set the same values as GitHub Action secrets)."
