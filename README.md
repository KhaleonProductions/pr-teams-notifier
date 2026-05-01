# PR Teams Notifier

Automatically sends a formatted notification to Microsoft Teams every time you create a Pull Request, **and** auto-generates a Feature Docs entry (AI-written summary + Excalidraw diagram) into a Microsoft Lists tab pinned to the channel — so every PR has its own browseable section without searching.

## What You Get

When you create a PR on a watched repo, a message is posted to your Teams channel with:
- PR title and link
- Repository name
- Branch name (e.g. `feature/dark-mode` → `main`)
- Date and time
- Number of files changed and lines added/removed
- **AI-written plain-English summary** (Claude Code SDK, Haiku 4.5 — uses ambient OAuth, no API key) — falls back to a deterministic summary if the SDK isn't authenticated
- **Inline Excalidraw diagram** of the change (Mermaid → Excalidraw via Kroki)
- Full description
- List of changed files
- A "View Pull Request" button

If you've configured the auto-doc Lists tab (Step 6 below), every PR also adds a row to the **Feature Docs** Microsoft Lists tab in the channel — one section per PR, fully browseable.

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

### Step 6 (Optional): Auto-doc to a Feature Docs Lists tab

This is the SG1-internal workflow: every PR adds a row to a Microsoft Lists tab pinned to the channel. Each row is one feature, with its own AI-written summary and Excalidraw diagram. No searching — just browse.

**You only need to do this once.** All auto-doc fields are optional; if any are missing, `notify.js` falls back to the plain notification.

#### 6.1 — Reuse the existing SG1 Azure app

We piggyback on the existing **`M365 Intelligence Pro Content`** app registration in SG1's Entra tenant. It already has `Sites.ReadWrite.All` and `Files.ReadWrite.All`, admin-consented. No new app, no new permissions.

1. Go to https://portal.azure.com → **Microsoft Entra ID** → **App registrations**.
2. Search for `M365 Intelligence Pro Content`. Open it.
3. Copy the **Application (client) ID** — this is `azure.contentClientId`.
4. Click **Certificates & secrets** → **Client secrets** → **+ New client secret**.
   - Description: `pr-teams-notifier`
   - Expires: 24 months
5. **Copy the secret VALUE immediately** (you won't see it again) — this is `azure.contentClientSecret`.
6. SG1 Azure tenant ID is `e5c2a9fc-8901-41cc-8e5a-d504e42e4ca0` — this is `azure.tenantId`.

#### 6.2 — Create the Feature Docs Microsoft List

1. Open Microsoft Teams → the team you want (e.g. **The Everything**) → channel **feature docs**.
2. Click **+** at the top of the channel → **Lists** → **Create a list** → **From scratch**.
3. Name it `Feature Docs`. Click Create.
4. Add these columns (use the EXACT names — no spaces — to match the field IDs in `notify.js`):

   | Column name | Type | Notes |
   |---|---|---|
   | (Title) | (built-in) | Holds the PR title |
   | `Repo` | Single line of text | |
   | `Branch` | Single line of text | |
   | `PRNumber` | Number | |
   | `PRURL` | Hyperlink | |
   | `Date` | Date and time | |
   | `Diagram` | Hyperlink (display as picture) | Set "Format URL as: Picture" in column settings so it thumbnails |
   | `Summary` | Multiple lines of text | |
   | `FilesChanged` | Number | |
   | `Lines` | Single line of text | |

   The List **automatically pins as a tab** in the channel. That's your custom Feature Docs tab — done.

#### 6.3 — Look up the site/list IDs

```bash
cd C:\code\pr-teams-notifier
bash bootstrap.sh
```

You'll be prompted for the Team display name. The script prints a `config.json` snippet with `siteId` and `listId` filled in.

#### 6.4 — Drop into config.json + GitHub Action secrets

Paste the snippet into your local `config.json`. Then, **for each repo where you want auto-doc** (e.g. `staino83/business_brain`), add these secrets in GitHub → Settings → Secrets and variables → Actions:

- `AZURE_TENANT_ID`
- `AZURE_CONTENT_CLIENT_ID`
- `AZURE_CONTENT_CLIENT_SECRET`
- `LISTS_SITE_ID`
- `LISTS_LIST_ID`
- `CLAUDE_OAUTH_CREDS` (optional — see 6.5 below)

(Plus the existing `TEAMS_WEBHOOK_URL`.)

#### 6.5 — Claude Code SDK auth (R03 — no API key)

`notify.js` calls Claude via `@anthropic-ai/claude-agent-sdk`'s `query()`. The SDK reads OAuth credentials from `~/.claude/.credentials.json` — there is **no Anthropic API key** anywhere in this stack.

**Local dev (terminal `gh pr-notify`):** if you've ever run `claude` (the CLI) and logged in, you're already set. The credentials file exists at `~/.claude/.credentials.json` — `notify.js` will use it automatically.

**GitHub Actions (web-UI PRs):** add a `CLAUDE_OAUTH_CREDS` repo secret containing the JSON contents of `~/.claude/.credentials.json` from a logged-in machine. The workflow writes it to `~/.claude/.credentials.json` on the runner before `notify.js` runs. If the secret is unset, AI gen is skipped and the basic notification falls back to the deterministic summary.

To capture your credentials JSON:
```bash
cat ~/.claude/.credentials.json    # mac/linux
type %USERPROFILE%\.claude\.credentials.json    # windows
```

Paste the full JSON value (one line) as the `CLAUDE_OAUTH_CREDS` secret. The SDK's auto-refresh will keep it warm across runs as long as the OAuth account isn't disabled.

#### 6.6 — Smoke test

Open a small PR on a watched repo. Within 60 seconds you should see:
- A card in the Teams channel with the AI summary + diagram inline.
- A new row in the **Feature Docs** Lists tab with the same data + clickable thumbnail.

If the diagram is missing, the AI step or Kroki render failed — check the Action logs. The notification still went out.

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
├── notify.js             # Core notification script (AI gen + Lists POST)
├── repos.json            # Watched repos list (managed via Teams)
├── gh-pr-notify.sh       # Local trigger (gh alias wrapper)
├── config.json           # Webhook URL + auto-doc config (gitignored)
├── config.example.json   # Template configuration
├── setup.sh              # One-time setup script
├── setup.bat             # Windows launcher for setup.sh
├── add-to-repo.sh        # Add GitHub Action to a repo
├── bootstrap.sh          # Looks up SharePoint site/list IDs for auto-doc
├── package.json          # Adds @excalidraw/mermaid-to-excalidraw dep
├── .github/workflows/
│   └── reusable-pr-notify.yml   # Reusable GitHub Action (forwards auto-doc secrets)
└── caller-workflow/
    └── pr-notify.yml     # Template to copy into other repos
```

## Auto-doc failure modes

The auto-doc pipeline is best-effort. Each step degrades independently:

| Failure | Behaviour |
|---|---|
| Claude Code SDK not authenticated (no `~/.claude/.credentials.json`, or `CLAUDE_OAUTH_CREDS` GHA secret unset) | Falls back to deterministic summary; no diagram. List row still posts (with the deterministic summary, no diagram URL). |
| Claude SDK error (rate limit, network) | Same fallback as above. |
| AI returned an invalid mermaid spec | Falls back to deterministic summary; no diagram. |
| `@excalidraw/mermaid-to-excalidraw` not installed | Card includes summary; no diagram; no list row. |
| Kroki / mermaid.ink unreachable from Teams' image renderer | Card includes URL; image just won't render in the card. |
| Microsoft Graph token / List POST fails | Card still posts with diagram; no list row added. |
| Teams webhook itself fails | Hard exit 1 (matches existing behaviour). |

The basic Teams notification ALWAYS goes out as long as the webhook URL works.

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
