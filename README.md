# PR Teams Notifier

Automatically sends a formatted notification to Microsoft Teams every time you create a Pull Request. Works from both the terminal and the GitHub web UI.

## What You Get

When you create a PR, a message is posted to your Teams channel with:
- PR title and link
- Repository name
- Branch name (e.g. `feature/dark-mode` → `main`)
- Date and time
- Number of files changed and lines added/removed
- Plain English summary of what changed
- Full description
- List of changed files
- A "View Pull Request" button

## How It Works

| Trigger | How | Coverage |
|---------|-----|----------|
| **Local** | `gh pr-notify` command (replaces `gh pr create`) | PRs created from your terminal |
| **Cloud** | GitHub Action | PRs created from GitHub web UI |

## Setup (One Time)

### Step 1: Create a Teams Webhook

1. Open **Microsoft Teams**
2. Go to the channel where you want notifications
3. Click the **+** tab at the top, or the channel's **...** menu
4. Search for **Workflows**
5. Choose **"Post to a channel when a webhook request is received"**
6. Name it (e.g. "PR Notifier"), select Team and Channel
7. Copy the webhook URL you're given

### Step 2: Configure the App

1. Copy the example config:
   ```bash
   cp config.example.json config.json
   ```
2. Edit `config.json` and paste your webhook URL:
   ```json
   {
     "teamsWebhookUrl": "https://your-webhook-url-here",
     "notifyAllRepos": true,
     "repos": [],
     "senderName": "PR Notifier"
   }
   ```

### Step 3: Run Setup

**Option A: Git Bash**
```bash
cd C:\code\pr-teams-notifier
bash setup.sh
```

**Option B: Double-click** `setup.bat` in File Explorer

This registers the `gh pr-notify` command globally — it works from any repo.

### Step 4 (Optional): Add GitHub Action to Your Repos

For PRs created from the GitHub web UI, add the workflow to each repo:

```bash
bash add-to-repo.sh C:/code/my-project
```

Then follow the printed instructions to commit the workflow file and add the `TEAMS_WEBHOOK_URL` secret.

## Usage

### From the terminal (replaces `gh pr create`)

```bash
gh pr-notify -t "Add dark mode" -b "Added a toggle button for dark mode"
```

All `gh pr create` flags work as normal. The Teams notification is sent automatically after the PR is created.

### From GitHub web UI

If you installed the GitHub Action (Step 4), notifications are sent automatically when a PR is opened.

## Configuration

### config.json

| Field | Description | Default |
|-------|-------------|---------|
| `teamsWebhookUrl` | Your Teams webhook URL | (required) |
| `notifyAllRepos` | Send notifications for all repos | `true` |
| `repos` | Allowlist of repos (only used when `notifyAllRepos` is `false`) | `[]` |
| `senderName` | Display name in the notification | `"PR Notifier"` |

### Limiting to specific repos

Set `notifyAllRepos` to `false` and list your repos:

```json
{
  "teamsWebhookUrl": "https://...",
  "notifyAllRepos": false,
  "repos": [
    "KhaleonProductions/resume-builder-pro",
    "KhaleonProductions/branch-practice"
  ]
}
```

## Adding a New Repo

### Local notifications
Nothing to do — `gh pr-notify` works in every repo automatically (when `notifyAllRepos` is `true`).

### GitHub Action notifications
```bash
bash add-to-repo.sh C:/code/new-repo
```
Then commit, push, and add the secret.

## Removing a Repo

### From local notifications
Set `notifyAllRepos` to `false` in config.json and remove the repo from the `repos` array.

### From GitHub Action notifications
Delete `.github/workflows/pr-notify.yml` from the repo and push.

## File Structure

```
pr-teams-notifier/
├── notify.js             # Core notification script
├── gh-pr-notify.sh       # Local trigger (gh alias wrapper)
├── config.json           # Your configuration (gitignored)
├── config.example.json   # Template configuration
├── setup.sh              # One-time setup script
├── setup.bat             # Windows launcher for setup.sh
├── add-to-repo.sh        # Add GitHub Action to a repo
├── .github/workflows/
│   └── reusable-pr-notify.yml   # Reusable GitHub Action
└── caller-workflow/
    └── pr-notify.yml     # Template to copy into other repos
```

## Troubleshooting

### "Teams webhook URL not configured"
Edit `config.json` and add your webhook URL, or run `setup.sh` again.

### "Could not extract PR URL"
The `gh pr create` command may have failed. Check the error output above the notification message.

### GitHub Action not firing
- Check that `.github/workflows/pr-notify.yml` exists in the repo
- Check that the `TEAMS_WEBHOOK_URL` secret is set (repo > Settings > Secrets)
- The action only fires on `opened` PRs, not updates to existing PRs
