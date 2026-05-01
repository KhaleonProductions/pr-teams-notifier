# Resume Plan — Per-Feature Auto-Doc (R27)

**Last session:** 2026-05-01
**Author:** Scott + Claude
**Pick this up at:** session startup tomorrow

---

## TL;DR — what to do first tomorrow

1. **Merge PR [staino83/business_brain#320](https://github.com/staino83/business_brain/pull/320)** — pins `business_brain`'s caller workflow to `@v1.0.0` (was `@master`). This is what unblocks the smoke test.
2. **Close PR [staino83/business_brain#319](https://github.com/staino83/business_brain/pull/319)** — failed smoke test from yesterday. Will be replaced by a fresh one.
3. **Open a new smoke-test PR** in `business_brain` — same pattern as PR #319 but against the now-pinned workflow. See "Smoke test commands" below.
4. **Watch Teams "feature docs" channel + Feature Docs Lists tab** — within 60s a card should appear and a Lists row should be created/upserted with a diagram attachment.
5. If smoke passes: merge PR [staino83/business_brain#321](https://github.com/staino83/business_brain/pull/321) (R27 docs update).
6. Then run `node backfill.mjs --dry-run` to sanity-check the matching, then `--feature xero` to verify a single feature, then full `node backfill.mjs`.

If anything goes sideways: **all the implementation code is already on master in `pr-teams-notifier` (commit `661f776` on master, tagged `v1.0.0`).** The worst case is you're debugging a CI plumbing issue, not lost work.

---

## What was built (yesterday's session)

A per-feature auto-doc system: every PR opened on `business_brain` upserts the touched feature's row in the SharePoint **Feature Docs** Lists tab (key = feature slug from `features.yaml`), with an AI-generated description + a Mermaid flow diagram regenerated from the feature's full surface, and a Teams card summarizing what was touched.

It also supports a one-shot **backfill** that walks the entire merged-PR history of `business_brain` and populates the catalog from scratch — one row per feature, with the historical contributing PRs and authors collected.

### High-level architecture

```
PR opens → pr-notify.yml (caller, @v1.0.0)
         → reusable-pr-notify.yml (in pr-teams-notifier)
         → notify.js
              ├── matchPRFiles  (which features did this PR touch?)
              ├── for each touched feature:
              │     ├── readSurfaceFiles (read full feature surface from caller repo)
              │     ├── generateFeatureDiagram (Claude SDK + mermaid.ink)
              │     ├── findItemBySlug → POST or PATCH (upsert Lists row)
              │     └── uploadAttachment (PNG to the row)
              └── postChannelCardViaBotFramework (Teams summary card)
```

### Spec + plan (the source of truth)

- **Spec:** `c:\code\pr-teams-notifier\docs\superpowers\specs\2026-05-01-feature-grouped-auto-doc-design.md` (on branch `docs/feature-grouped-auto-doc-spec`)
- **Plan:** `c:\code\pr-teams-notifier\docs\superpowers\plans\2026-05-01-feature-grouped-auto-doc.md` (same branch)

Both are also reachable on `feature/auto-doc-feature-grouped` and on master in `pr-teams-notifier` (since they were squash-merged via PR #2).

---

## Where everything lives

| Thing | Path / URL |
|---|---|
| Implementation worktree | `c:\code\pr-teams-notifier\.worktrees\impl` (branch: `feature/auto-doc-feature-grouped`) |
| Implementation branch | `feature/auto-doc-feature-grouped` (pushed to remote) |
| Spec/plan branch | `docs/feature-grouped-auto-doc-spec` (in `pr-teams-notifier`, NOT pushed) |
| Production code | `pr-teams-notifier` master @ commit `661f776`, tagged `v1.0.0` |
| Caller workflow | `business_brain/.github/workflows/pr-notify.yml` (on `feature/r27-auto-doc` branch) — currently `@master`, **PR #320 pins it to @v1.0.0** |
| Feature inventory | `pr-teams-notifier/features.yaml` (5 starter entries; needs more) |
| `business_brain` checkout | `c:\code\the everything\business_brain` |

### Branch summary

**`pr-teams-notifier` repo:**
- `master` — has the new implementation (merged via PR #2). Tagged `v1.0.0`.
- `feature/auto-doc-feature-grouped` — what we built on. Now redundant (squashed into master) but worktree still references it.
- `feature/auto-doc-lists-tab` — the older WIP branch; superseded but keep around for now.
- `docs/feature-grouped-auto-doc-spec` — local-only, has spec + plan. Not pushed.

**`business_brain` repo:**
- `master` — untouched
- `feature/r27-auto-doc` — has the caller workflow. PRs #320 and #321 are open against this branch.
- `chore/pin-pr-notifier-to-v1` — PR #320 (pin to v1.0.0)
- `docs/r27-upsert-clarification` — PR #321 (R27 doc update)
- `smoke-test/xero-auto-doc-v2` — PR #319 (failed smoke test, close it)

---

## Current state of all 7 phases

| Phase | Status | Notes |
|---|---|---|
| **0.1** Merge `feature/auto-doc-lists-tab` → master in `pr-teams-notifier` + tag v1.0.0 | ✅ DONE | [PR #2](https://github.com/KhaleonProductions/pr-teams-notifier/pull/2) merged as `661f776`; tag pushed |
| **0.2** Pin `business_brain` caller to `@v1.0.0` | 🟡 PR open | [PR #320](https://github.com/staino83/business_brain/pull/320) — **MERGE FIRST TOMORROW** |
| **0.3** Re-trigger smoke test PR | ❌ Failed | [PR #319](https://github.com/staino83/business_brain/pull/319) failed at workflow parse — likely Actions cache of `@master` immediately post-merge. Pinning to tag should fix. |
| **1.1–1.5** Phase 1 (inventory, matcher, planner) | ✅ DONE | 23 jest tests, all pass |
| **2.1–2.3** Phase 2 (surfaceReader, diagramGenerator, smoke harness) | ✅ DONE | |
| **3.1–3.2** Phase 3 (sharepointClient, smoke harness) | ✅ DONE | |
| **4.1–4.3** Phase 4 (githubClient, notify.js refactor, botFrameworkClient) | ✅ DONE | notify.js: 645 → ~200 LOC orchestrator |
| **5.1** Phase 5 (backfill.mjs) | ✅ DONE | Supports `--feature`, `--resume`, `--dry-run` |
| **6.1** Phase 6 (SMOKE_TEST.md) | ✅ DONE | At `pr-teams-notifier/docs/SMOKE_TEST.md` |
| **7.1** Phase 7 (R27 doc update) | 🟡 PR open | [PR #321](https://github.com/staino83/business_brain/pull/321) — merge after smoke passes |

---

## Open PRs awaiting your action

| PR | Repo | Purpose | Action |
|---|---|---|---|
| [pr-teams-notifier#2](https://github.com/KhaleonProductions/pr-teams-notifier/pull/2) | pr-teams-notifier | Per-feature auto-doc (impl) | ✅ Already merged + tagged v1.0.0 |
| [business_brain#319](https://github.com/staino83/business_brain/pull/319) | business_brain | Smoke test (failed) | **Close** |
| [business_brain#320](https://github.com/staino83/business_brain/pull/320) | business_brain | Pin caller to @v1.0.0 | **Merge first** |
| [business_brain#321](https://github.com/staino83/business_brain/pull/321) | business_brain | R27 docs update | Merge after smoke passes |

---

## The smoke test failure (root cause + fix)

**Symptom:** [Run 25219269389](https://github.com/staino83/business_brain/actions/runs/25219269389) on PR #319 shows `conclusion: failure`, `jobs: []`, "workflow file issue" — never started any actual job.

**Why this is suspicious:**
- The new reusable workflow on `pr-teams-notifier@master` declares all 13 secrets the caller passes (verified via `gh api`).
- The caller passes nothing the reusable doesn't declare.
- The PR fired ~1 min 37 sec after the merge to master.

**Hypothesis:** GitHub Actions caches the resolved reusable-workflow content briefly. The action runner saw a stale pre-merge version of `@master` (which had only 1 secret declared).

**Fix:** Pin to `@v1.0.0` (PR #320). Tags are content-addressable and don't suffer from the same cache surprise.

**If smoke still fails after the pin merges:** Real bug. Look at workflow run logs. The most likely root causes in priority order:
1. New `LISTS_DISPFORM_BASE_URL` secret declared in reusable but somehow rejected (unlikely — it's optional)
2. The new caller checkout step (`actions/checkout@v4` for the calling repo) is missing a permission or running a default that conflicts
3. A YAML indentation / structure issue in `pr-teams-notifier/.github/workflows/reusable-pr-notify.yml` on master that I missed

---

## Tomorrow's sequence (copy-pasteable)

### Step 1 — Merge the pin PR
```powershell
cd "c:\code\the everything\business_brain"
gh pr merge 320 --squash --delete-branch
```

### Step 2 — Close the failed smoke test
```powershell
gh pr close 319 --comment "Replacing with a fresh smoke test now that the caller is pinned to v1.0.0"
```

### Step 3 — Open a new smoke test PR
```powershell
cd "c:\code\the everything\business_brain"
git fetch origin feature/r27-auto-doc
git checkout -b smoke-test/xero-auto-doc-v3 origin/feature/r27-auto-doc
New-Item -ItemType File -Path teams_bot/src/services/bookkeeper/.smoke-test-marker-xero-v3 -Force | Out-Null
"smoke test v3: pinned to v1.0.0`nthis file can be deleted after the round-trip is verified" | Out-File teams_bot/src/services/bookkeeper/.smoke-test-marker-xero-v3 -Encoding utf8 -NoNewline
git add teams_bot/src/services/bookkeeper/.smoke-test-marker-xero-v3
git commit -m "smoke test v3: xero auto-doc with pinned reusable workflow"
git push -u origin smoke-test/xero-auto-doc-v3
gh pr create --base feature/r27-auto-doc --head smoke-test/xero-auto-doc-v3 `
  --title "Smoke test v3: xero app — auto-doc round-trip (pinned to v1.0.0)" `
  --body "Smoke test for the per-feature auto-doc flow using the v1.0.0-pinned caller workflow."
```

### Step 4 — Watch the workflow
```powershell
gh run watch --exit-status
```

### Step 5 — Verify in Teams + Lists tab
- [ ] Adaptive card appears in **The Everything → feature docs** channel
- [ ] Card lists "bookkeeper" as the touched feature
- [ ] Lists tab "Feature Docs" has a `bookkeeper` row with diagram PNG attachment
- [ ] `ContributingPRs` field includes the new smoke PR
- [ ] `Authors` field includes the PR author

### Step 6 — Close smoke PR + merge docs PR
```powershell
gh pr close <smoke-pr-number> --comment "Smoke verified — closing"
gh pr merge 321 --squash --delete-branch
```

### Step 7 — Backfill (only after smoke passes)
```powershell
# Set env vars first (see "Required env vars" section below)
cd "c:\code\pr-teams-notifier\.worktrees\impl"
node backfill.mjs --dry-run
# Verify PR-per-feature counts look right
node backfill.mjs --feature xero
# Spot-check the xero row in Lists tab
node backfill.mjs
# Verify row count = features.yaml count
```

---

## Required env vars for local testing

Set these before running `backfill.mjs` or the smoke harness scripts. All are already configured as GitHub Actions secrets — values come from your local credential store.

| Var | Where to get it | Used by |
|---|---|---|
| `AZURE_TENANT_ID` | SG1 Azure portal | both |
| `AZURE_CONTENT_CLIENT_ID` | M365 Intelligence Pro Content app | both |
| `AZURE_CONTENT_CLIENT_SECRET` | M365 Intelligence Pro Content app secrets | both |
| `LISTS_SITE_ID` | SharePoint site for Feature Docs | both |
| `LISTS_LIST_ID` | Feature Docs list ID | both |
| `REPO_DIR` | `c:/code/the everything/business_brain` | both |
| `GITHUB_TOKEN` | `gh auth token` | both |
| `GH_OWNER` | `staino83` | backfill |
| `GH_REPO` | `business_brain` | backfill |
| `BOT_HOME_AZURE_TENANT_ID` | Bot's home tenant | per-PR (not used by backfill) |
| `TEAMS_APP_ID` | Bot Framework app ID | per-PR |
| `TEAMS_APP_PASSWORD` | Bot Framework client secret | per-PR |
| `TARGET_TEAM_ID` | Teams group ID | per-PR |
| `TARGET_CHANNEL_ID` | Channel within team | per-PR |
| `LISTS_DISPFORM_BASE_URL` | (optional) SharePoint DispForm URL for deep links from cards | per-PR |
| `SURFACE_REF` | (optional, defaults to HEAD) | per-PR |
| `SKIP_TEAMS=1` | Set when backfilling to suppress card spam | backfill |
| `FEATURES_YAML` | (optional, defaults to `features.yaml` in cwd) | both |
| `CLAUDE_OAUTH_CREDS` | JSON from `~/.claude/.credentials.json` | both (also auto-loaded by SDK from that path) |

---

## Smoke test commands (no GH Actions, just local)

### Test the diagram pipeline locally (no SharePoint, no Teams)

```powershell
cd "c:\code\pr-teams-notifier\.worktrees\impl"
# Requires ~/.claude/.credentials.json (Claude Code SDK reads it directly)
node scripts/test-diagram-roundtrip.mjs --feature xero `
  --repo "c:/code/the everything/business_brain" `
  --out tmp/xero.png
```
Open `tmp/xero.png` to inspect the diagram. Logs the AI summary + Mermaid source to console.

### Test SharePoint roundtrip against a TEST list

```powershell
# Provide TEST_LISTS_SITE_ID and TEST_LISTS_LIST_ID (separate from production!)
cd "c:\code\pr-teams-notifier\.worktrees\impl"
node scripts/test-list-roundtrip.mjs
```

### Backfill dry-run (no SharePoint, no Claude)

```powershell
cd "c:\code\pr-teams-notifier\.worktrees\impl"
$env:REPO_DIR = "c:/code/the everything/business_brain"
$env:GH_OWNER = "staino83"
$env:GH_REPO = "business_brain"
$env:GITHUB_TOKEN = (gh auth token)
node backfill.mjs --dry-run
```

---

## Implementation summary

### Modules created (all in `pr-teams-notifier/src/`)

| Module | Purpose | Test coverage |
|---|---|---|
| `featureInventory.js` | Load + validate `features.yaml` | 4 jest tests |
| `featureMatcher.js` | PR file list → matched features (minimatch + negation) | 8 jest tests |
| `upsertPlanner.js` | Pure POST/PATCH payload + dedup PRs/authors | 9 jest tests |
| `surfaceReader.js` | Read files matching globs from a git ref | 2 jest tests |
| `diagramGenerator.js` | Claude SDK + mermaid.ink, with retries | smoke (manual) |
| `sharepointClient.js` | Graph API: token, find-by-slug, create, patch, attachment | smoke (manual) |
| `githubClient.js` | List merged PRs, get PR file list | implicit via backfill |
| `botFrameworkClient.js` | Token + post card + buildCard | implicit via notify.js |
| `retry.js` | retryOnce wrapper | implicit |

### Orchestrators

- **`notify.js`** (~200 LOC) — per-PR upsert orchestrator. Reads PR data from env or `PR_JSON`, matches files to features, runs the per-feature loop with try/catch isolation, posts the Teams card.
- **`backfill.mjs`** — one-shot. Walks all merged PRs once to map `feature.slug → [PRs]`, then concurrent (limit 4) per-feature processing. Supports `--feature`, `--resume`, `--dry-run`.

### Other artifacts

- **`features.yaml`** — 5 starter entries (xero, gate-engine, bookkeeper, trak-integration, feature-registry). **Needs more entries before backfill** — see "Deferred work" below.
- **`docs/SMOKE_TEST.md`** — full smoke procedure with troubleshooting.
- **`scripts/test-diagram-roundtrip.mjs`** — local diagram QA harness.
- **`scripts/test-list-roundtrip.mjs`** — SharePoint CRUD roundtrip harness.

---

## All commits made (in chronological order)

On `pr-teams-notifier/feature/auto-doc-feature-grouped` (squashed into master via PR #2):

```
f79921c chore: add jest, minimatch, js-yaml for feature-grouped auto-doc
20fcb4c feat(inventory): seed features.yaml with starter feature surface globs
d06e1fa feat(inventory): loadFeatureInventory with validation
2225f6c fix(test): use --experimental-vm-modules so npm test runs ESM jest
6bebe1a feat(matcher): PR file → feature matching with minimatch + negation
91eb737 feat(planner): pure upsert payload + dedup PRs/authors
d0b1967 feat(surface): read files matching globs from a git ref
74b3ba8 feat(diagram): per-feature diagram generation via Claude SDK + mermaid.ink
c55b30f test(diagram): smoke harness for end-to-end diagram generation
6020aba feat(sharepoint): client with find-by-slug, create, patch, attachment upload
622a4d2 test(sharepoint): smoke harness for create/find/patch roundtrip
e022145 feat(github): client for PR file list + merged PR enumeration
a9b768a refactor(teams): extract Bot Framework client into module
58e0318 refactor(notify): per-feature upsert loop using new modules
977bc47 fix: address code review — retries, env preflight, headSha fallback, buildCard decoupling
d73188a feat(backfill): one-shot orchestrator for full-history feature catalog
de193cf docs: smoke test procedure for per-PR + backfill flows
9abe69a ci(workflow): wire REPO_DIR + caller checkout + new env vars for per-feature notify
```

Squashed onto master as commit `661f776`, tagged `v1.0.0`.

In `business_brain`:
- `chore/pin-pr-notifier-to-v1`: `1f4e715f` (PR #320)
- `docs/r27-upsert-clarification`: `f351f345` (PR #321)
- `smoke-test/xero-auto-doc-v2`: `954deaa8` (PR #319, to close)

---

## Deferred work / known issues

### Critical-path items (do soon)
- **Expand `features.yaml`** before running full backfill. The 5 starter entries cover only the most obvious features. Other things in `business_brain/teams_bot/src/services/` likely need entries: `proactiveIntelligence`, `mcpToolServer`, `confirmationSystem`, `remediationEngine`, `commProcessDiscovery`, `claudeChat`, `brain/dispatcher`, `memory/conflictDetector`, `gateEngine` (already in), `feature-registry` (already in), `financialIntegration`, `integrationRegistry`, `featureRegistry`, etc. **Open PR to add them.**
- **Verify `LISTS_DISPFORM_BASE_URL` setup** — if you want clickable Lists row links in Teams cards, set this secret. Without it, cards show `(item N)` text instead.

### Code quality follow-ups (deferred during silent run)
- OData filter in `findItemBySlug` doesn't escape single quotes (slugs are kebab-case so harmless today). Add `.replace(/'/g, "''")` if a slug ever contains a quote.
- Per-feature loop in `notify.js` is fully serial. With many touched features, total wall-time is bounded by sum of Claude calls. `pLimit(2)` would halve it. Backfill already uses `pLimit(4)`.
- Note in `diagramGenerator.js`: when SDK emits multiple StructuredOutput tool_use blocks, last one wins. Add a comment.

### Architecture considerations
- **Pinning `@v1.0.0` is good**, but means new versions need a manual bump in `business_brain/.github/workflows/pr-notify.yml`. Worth adding a Renovate rule or auto-bump bot eventually.
- **Backfill cost:** ~30 features × ~one Claude call each = ~30 Claude SDK invocations + ~30 mermaid.ink renders + ~30 SharePoint POSTs/PATCHes + ~30 attachment uploads. Should complete in ~5-10 min with `pLimit(4)`. Cost is small but real — don't run twice without `--resume`.
- **Going-forward upsert idempotency:** If you re-trigger the same PR (close/reopen), `mergeContributingPRs` dedupes by PR number — safe. But the diagram regenerates each time (Claude is non-deterministic), so the row's diagram + description WILL change between runs. This is a feature, not a bug, but document if surprising.

---

## Related session memory

The `using-superpowers` framework expects you to capture user/feedback memories across sessions. Today's session-relevant memories already saved:

- `C:\Users\scott\.claude\projects\C--code-the-everything\memory\user_scott.md` — your name, comm style, repo context
- `C:\Users\scott\.claude\projects\C--code-the-everything\memory\MEMORY.md` — the index

Tomorrow's session will auto-load these.

---

## Reference links

- Spec doc: `docs/superpowers/specs/2026-05-01-feature-grouped-auto-doc-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-01-feature-grouped-auto-doc.md`
- pr-teams-notifier merged PR: https://github.com/KhaleonProductions/pr-teams-notifier/pull/2
- pr-teams-notifier v1.0.0 tag: https://github.com/KhaleonProductions/pr-teams-notifier/releases/tag/v1.0.0
- business_brain pin PR (#320): https://github.com/staino83/business_brain/pull/320
- business_brain R27 docs PR (#321): https://github.com/staino83/business_brain/pull/321
- business_brain failed smoke (#319 — close): https://github.com/staino83/business_brain/pull/319
- Failed smoke test run: https://github.com/staino83/business_brain/actions/runs/25219269389

---

**Resume from "Tomorrow's sequence" above. Good luck!**
