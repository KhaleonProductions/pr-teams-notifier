# PR Teams Notifier

Automatically sends a formatted notification to Microsoft Teams every time you create a Pull Request. Team members can control which repos are watched directly from the Teams channel.

## What You Get

When you create a PR on a watched repo, a message is posted to your Teams channel with:
- PR title and link
- Repository name
- Branch name (e.g. `feature/dark-mode` → `main`)
- Date and time
- Number of files changed and lines added/removed
- Plain English summary of what changed
- Full description
- List of changed files
- A "View Pull Request" button

## Teams Commands

Anyone in the Teams channel can type these commands to manage which repos send notifications:

| Command | What it does |
|---------|-------------|
| `watch owner/repo-name` | Start getting PR notifications for that repo |
| `unwatch owner/repo-name` | Stop getting PR notifications for that repo |
| `list repos` | Show all currently watched repos |

Examples:
```
watch KhaleonProductions/resume-builder-pro
unwatch KhaleonProductions/branch-practice
list repos
```

These commands are handled by Power Automate flows (see setup below).

## How It Works

| Trigger | How | Coverage |
|---------|-----|----------|
| **Local** | `gh pr-notify` command (replaces `gh pr create`) | PRs created from your terminal |
| **Cloud** | GitHub Action | PRs created from GitHub web UI |
| **Repo list** | `repos.json` on GitHub, managed via Teams commands | Controlled by your team |

## Setup

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
     "senderName": "PR Notifier",
     "repos": []
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

### Step 5: Set Up Teams Commands (Power Automate)

This enables the `watch`, `unwatch`, and `list repos` commands in your Teams channel.

#### Prerequisites

**Create a GitHub Personal Access Token (PAT):**
1. Go to https://github.com/settings/tokens
2. Click **Fine-grained tokens** > **Generate new token**
3. Name: `Power Automate PR Notifier`
4. Repository access: **Only select repositories** > choose `pr-teams-notifier`
5. Permissions: **Contents** > **Read and write**
6. Click **Generate token** and copy it — you'll need it for the flows below

#### Flow 1: Watch a Repo

1. Go to https://make.powerautomate.com
2. Click **Create** > **Automated cloud flow**
3. Name: `PR Notifier - Watch Repo`
4. Trigger: **When a new channel message is posted** (Microsoft Teams)
   - Select your Team and Channel
5. Add a **Condition**:
   - Left: `toLower(triggerOutputs()?['body/plainTextContent'])`
   - Operator: **starts with**
   - Right: `watch `
   - Add another row: same left value **does not start with** `unwatch`
6. In the **Yes** branch, add **Compose** (name: "Extract Repo Name"):
   - Input: `trim(substring(toLower(triggerOutputs()?['body/plainTextContent']), 6))`
7. Add **HTTP** action (name: "Get repos.json"):
   - Method: `GET`
   - URI: `https://api.github.com/repos/KhaleonProductions/pr-teams-notifier/contents/repos.json`
   - Headers: `Accept`: `application/vnd.github.v3+json`, `Authorization`: `Bearer YOUR_PAT_HERE`, `User-Agent`: `PowerAutomate`
8. Add **Compose** (name: "Decode Content"):
   - Input: `json(base64ToString(body('Get_repos.json')?['content']))`
9. Add **Condition**: check if repo already exists
   - `contains(string(outputs('Decode_Content')?['repos']), outputs('Extract_Repo_Name'))` equals `false`
10. In the **Yes** branch (new repo):
    - **Compose** "Updated Repos": `union(outputs('Decode_Content')?['repos'], createArray(outputs('Extract_Repo_Name')))`
    - **Compose** "New File Content": `json(concat('{"repos":', string(outputs('Updated_Repos')), '}'))`
    - **HTTP** PUT to update the file:
      - URI: same as step 7
      - Headers: same as step 7
      - Body: `{"message": "Add repo to watch list", "content": "@{base64(string(outputs('New_File_Content')))}", "sha": "@{body('Get_repos.json')?['sha']}"}`
    - **Post message in channel**: `Now watching @{outputs('Extract_Repo_Name')} for PR notifications.`
11. In the **No** branch (already watched):
    - **Post message in channel**: `@{outputs('Extract_Repo_Name')} is already being watched.`
12. **Save** the flow

#### Flow 2: Unwatch a Repo

1. Create a new **Automated cloud flow**: `PR Notifier - Unwatch Repo`
2. Same trigger (same Team and Channel)
3. **Condition**: message starts with `unwatch `
4. In **Yes** branch:
   - **Compose** "Extract Repo Name": `trim(substring(toLower(triggerOutputs()?['body/plainTextContent']), 8))`
   - **HTTP GET** repos.json (same as Flow 1)
   - **Compose** "Decode Content" (same as Flow 1)
   - **Condition**: repo exists in list
   - In **Yes** (repo found):
     - **Filter array**: From `outputs('Decode_Content')?['repos']`, where `item()` is not equal to `outputs('Extract_Repo_Name')`
     - **Compose** "New File Content": `json(concat('{"repos":', string(body('Filter_array')), '}'))`
     - **HTTP PUT** to update (same as Flow 1, with updated content)
     - **Post message**: `Stopped watching @{outputs('Extract_Repo_Name')}.`
   - In **No** (repo not in list):
     - **Post message**: `@{outputs('Extract_Repo_Name')} is not currently being watched.`
5. **Save** the flow

#### Flow 3: List Watched Repos

1. Create a new **Automated cloud flow**: `PR Notifier - List Repos`
2. Same trigger (same Team and Channel)
3. **Condition**: message contains `list repos`
4. In **Yes** branch:
   - **HTTP GET** repos.json (same as other flows)
   - **Compose** "Decode Content" (same as other flows)
   - **Compose** "Format List": `join(outputs('Decode_Content')?['repos'], ', ')`
   - **Post message**: `Currently watching @{length(outputs('Decode_Content')?['repos'])} repo(s): @{outputs('Format_List')}`
5. **Save** the flow

## Usage

### From the terminal (replaces `gh pr create`)

```bash
gh pr-notify -t "Add dark mode" -b "Added a toggle button for dark mode"
```

All `gh pr create` flags work as normal. The Teams notification is sent automatically if the repo is in the watched list.

### From GitHub web UI

If you installed the GitHub Action (Step 4), notifications are sent automatically when a PR is opened on a watched repo.

### Managing watched repos from Teams

Just type in the Teams channel:
```
watch KhaleonProductions/my-new-repo
```

## Configuration

### config.json

| Field | Description | Default |
|-------|-------------|---------|
| `teamsWebhookUrl` | Your Teams webhook URL | (required) |
| `senderName` | Display name in the notification | `"PR Notifier"` |
| `repos` | Fallback repo list (used if GitHub fetch fails) | `[]` |

### repos.json (on GitHub)

This is the primary repo watch list, managed via Teams commands. You can also edit it directly on GitHub if needed.

## File Structure

```
pr-teams-notifier/
├── notify.js             # Core notification script
├── repos.json            # Watched repos list (managed via Teams)
├── gh-pr-notify.sh       # Local trigger (gh alias wrapper)
├── config.json           # Webhook URL config (gitignored)
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

### "Skipping: repo is not in the watched repos list"
The repo isn't in `repos.json`. Type `watch owner/repo-name` in the Teams channel to add it.

### GitHub Action not firing
- Check that `.github/workflows/pr-notify.yml` exists in the repo
- Check that the `TEAMS_WEBHOOK_URL` secret is set (repo > Settings > Secrets)
- The action only fires on `opened` PRs, not updates to existing PRs

### Teams commands not working
- Check your Power Automate flows are turned on at https://make.powerautomate.com
- Verify the GitHub PAT hasn't expired
- Check the flow run history for error details
