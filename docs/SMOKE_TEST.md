# Auto-doc smoke test

## Per-PR pipeline (going-forward flow)

1. In `business_brain`, open a no-op PR touching one tracked feature:
   ```bash
   git checkout -b smoke-test/auto-doc-$(date +%s)
   echo "smoke" > teams_bot/src/services/bookkeeper/.smoke-test-marker
   git add . && git commit -m "smoke test: trigger auto-doc"
   git push -u origin HEAD
   gh pr create --base feature/r27-auto-doc --title "Smoke test: auto-doc" --body "no-op"
   ```
2. Watch the workflow:
   ```bash
   gh run watch --exit-status
   ```
3. Within 60s, verify in Teams "feature docs" channel:
   - [ ] Card appears
   - [ ] Card lists "bookkeeper" as touched
   - [ ] Card has "View row" link (or "(item N)" text if `LISTS_DISPFORM_BASE_URL` is unset)
4. Open the Feature Docs Lists tab:
   - [ ] "bookkeeper" row exists, with diagram attachment
   - [ ] ContributingPRs has the new PR
   - [ ] Authors includes the PR author
5. Close the PR.

## Backfill (one-shot)

1. Run dry-run first (no SharePoint calls — just validates PR-to-feature matching):
   ```bash
   REPO_DIR="c:/code/the everything/business_brain" \
     GH_OWNER=staino83 GH_REPO=business_brain \
     GITHUB_TOKEN=$(gh auth token) \
     node backfill.mjs --dry-run
   ```
2. Verify PR-per-feature counts look right (xero should have several PRs, gate-engine several, etc.).
3. Run for one feature first (uses ~one Claude SDK call):
   ```bash
   AZURE_TENANT_ID=... AZURE_CONTENT_CLIENT_ID=... AZURE_CONTENT_CLIENT_SECRET=... \
     LISTS_SITE_ID=... LISTS_LIST_ID=... \
     REPO_DIR="c:/code/the everything/business_brain" \
     GH_OWNER=staino83 GH_REPO=business_brain \
     GITHUB_TOKEN=$(gh auth token) \
     node backfill.mjs --feature xero
   ```
4. Verify in Lists tab:
   - [ ] xero row exists
   - [ ] Description is a sensible AI summary
   - [ ] Diagram PNG is attached
   - [ ] ContributingPRs has all xero-touching PRs
5. Run all (with all the same env vars):
   ```bash
   node backfill.mjs
   ```
6. Verify row count == feature count in `features.yaml`.
7. If `backfill-errors.json` exists, review it and re-run failed features:
   ```bash
   node backfill.mjs --feature <slug>
   ```

## Required env vars summary

| Var | Used by | Notes |
|---|---|---|
| `AZURE_TENANT_ID` | both | SG1 tenant |
| `AZURE_CONTENT_CLIENT_ID` | both | M365 Intelligence Pro Content app |
| `AZURE_CONTENT_CLIENT_SECRET` | both | client secret for the above |
| `LISTS_SITE_ID` | both | SharePoint site |
| `LISTS_LIST_ID` | both | Feature Docs list ID |
| `REPO_DIR` | both | Path to checked-out business_brain repo |
| `GITHUB_TOKEN` | both | Read access to PRs and files |
| `GH_OWNER` | backfill | `staino83` |
| `GH_REPO` | backfill | `business_brain` |
| `BOT_HOME_AZURE_TENANT_ID` | per-PR | Where the bot is registered |
| `TEAMS_APP_ID` | per-PR | Bot Framework app ID |
| `TEAMS_APP_PASSWORD` | per-PR | Bot Framework client secret |
| `TARGET_TEAM_ID` | per-PR | Teams group ID |
| `TARGET_CHANNEL_ID` | per-PR | Channel within the team |
| `LISTS_DISPFORM_BASE_URL` | per-PR (optional) | If set, Teams card includes deep links to Lists rows |
| `SURFACE_REF` | per-PR (optional) | Defaults to HEAD; override for local backfill against a different ref |
| `SKIP_TEAMS` | both (optional) | Set to `1` to suppress Teams card posting |
| `FEATURES_YAML` | both (optional) | Defaults to `features.yaml` in cwd |
| `CLAUDE_OAUTH_CREDS` | both | JSON string; CI workflow writes it to `~/.claude/.credentials.json` |
| `PR_JSON` | per-PR (alt) | If set, notify.js parses PR data from this JSON instead of individual env vars |

## Troubleshooting

- **"Missing env" error**: the preflight check fired. Add the listed vars and re-run.
- **All features fail with "fatal: Not a valid object name"**: `REPO_DIR` is wrong, or `SURFACE_REF` points to an unfetched SHA. Default to `HEAD` (which means whatever the workspace is checked out at).
- **mermaid.ink returns 400/500**: AI generated invalid Mermaid. The retry strips styles and tries again. If both fail, the error has the response body — usually a syntax issue in `flowchart TD ...`. Check the AI prompt for prompt drift.
- **SharePoint 401**: client secret expired. Rotate via Azure Portal → M365 Intelligence Pro Content app → Certificates & secrets.
- **SharePoint 404 on attachment upload**: confirm the list's drive is provisioned. Visit the list in the browser and add a test attachment manually first; the drive is created on-demand.
