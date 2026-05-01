# Feature-grouped auto-doc — design

**Date:** 2026-05-01
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Owner:** Scott Abbott
**Related:** R27 (`business_brain/docs/UNIVERSAL_RULES.md`), PRs `staino83/business_brain#309` (closed) and `#314` (open smoke test, failed at startup)

## 1. Problem

The R27 auto-doc pipeline does not currently work end-to-end. Two distinct problems:

1. **Pipeline broken.** `business_brain/.github/workflows/pr-notify.yml` calls the reusable workflow at `KhaleonProductions/pr-teams-notifier/.github/workflows/reusable-pr-notify.yml@master`, passing 13 secrets. Master only declares `TEAMS_WEBHOOK_URL`, so GitHub Actions rejects the call with `startup_failure` (see [run 25214065830](https://github.com/staino83/business_brain/actions/runs/25214065830)). The updated reusable workflow + `notify.js` (Bot Framework + Claude SDK + mermaid.ink + SharePoint List) exists locally on `feature/auto-doc-lists-tab` but has not been merged.

2. **Catalog is empty.** Every existing feature in `business_brain` (xero, trak, bookkeeper, gateEngine, ~30 others) merged before R27 was working. Even after fixing the pipeline, the Feature Docs Lists tab will only fill up over months as new PRs land. The user wants a **populated catalog today**, with a **per-feature visual flow chart** for every feature in the codebase.

## 2. Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Backfill scope | All-time (every merged PR) | User: "backfill all time" |
| Catalog granularity | Per-feature (one Lists row per feature, not per PR) | User chose option B over option A; cleaner browsable catalog |
| R27 going-forward behavior | **Upsert** the touched feature's row (not insert per PR) | Consistency with per-feature backfill; chosen as A1 |
| Feature inventory source | Manually curated `features.yaml` in `pr-teams-notifier` | Chosen as B2; load-bearing inventory, hand-editable |
| PR author attribution | Required, both per-PR (`ContributingPRs`) and aggregated (`Authors`) | User asked for it explicitly |
| Diagram quality | Paramount — generate from full feature surface, not PR diff; no row written if diagram fails | User: "remembering that a visual diagram is paramount" |

## 3. Architecture

Two flows in one repo (`pr-teams-notifier`):

### Flow 1 — Backfill (one-shot)

```
features.yaml (manually curated)
        ↓
backfill.mjs walks each feature:
  1. Read all files matching surfaceGlobs at HEAD
  2. Claude SDK → AI summary + Mermaid spec
  3. mermaid.ink → PNG, uploaded to SharePoint as item attachment
  4. git log -- <surfaceGlobs> → list of contributing PR #s + authors
  5. Upsert Lists row (key = feature slug)
        ↓
Feature Docs Lists tab — one row per feature, fully populated
```

### Flow 2 — Going-forward (per-PR)

```
PR opens → pr-notify.yml → reusable-pr-notify.yml → notify.js
        ↓
1. Read PR file list (GitHub API)
2. Match files against features.yaml surfaceGlobs (minimatch)
3. For each touched feature:
   - Regenerate diagram from current surface (PR head SHA)
   - Append PR # + author to ContributingPRs
   - Merge author into Authors (deduped)
   - Update LastUpdated
   - Upsert Lists row
4. Post Bot Framework card to "feature docs" Teams channel
   summarizing which features changed
```

### Invariants

- `features.yaml` is the **load-bearing inventory**. Adding/renaming a feature = edit the yaml.
- A PR with **0 features matched + uncovered files** → Teams warning ("PR #N touches uncategorized files: X, Y, Z — add them to features.yaml"), no Lists writes.
- A PR with **N matched features + uncovered files** → upsert the matched features, append the warning to the Teams card.
- Diagrams always regenerate from current code state. Stale diagrams self-heal on the next PR that touches that feature.

## 4. Data shapes

### `features.yaml`

```yaml
features:
  - slug: xero
    displayName: Xero accounting integration
    description: OAuth onboarding, REST client, MCP tools, Trak↔Xero gate.
    surfaceGlobs:
      - teams_bot/src/cards/xeroOnboardingCard.ts
      - teams_bot/src/routes/xeroAuth.ts
      - teams_bot/src/services/bookkeeper/xero*.ts
      - teams_bot/src/services/trakIntegration/xeroGate.ts
      - teams_bot/src/services/xeroOnboardingDetection.ts
      - teams_bot/supabase/migrations/080_xero_reference_cache.sql
  - slug: gate-engine
    displayName: HITL gate engine
    description: Universal human-in-the-loop gate framework.
    surfaceGlobs:
      - teams_bot/src/services/gateEngine/**
  # ... ~30 entries total
```

`surfaceGlobs` uses standard glob syntax, matched against PR file lists with `minimatch`.

### Feature Docs Lists tab — schema

| Column | Type | Notes |
|---|---|---|
| Title | text | = `displayName` |
| **Slug** | text (unique key) | = `slug` from yaml — primary identity for upsert |
| Description | multi-line text | AI-generated summary of the feature |
| Diagram | image attachment | PNG from mermaid.ink, uploaded as item attachment |
| DiagramSource | multi-line text | Mermaid source — lets you re-render or edit later |
| ContributingPRs | multi-line text | One PR per line: `#314 — Smoke test: xero app — @KhaleonProductions (2026-05-01)` |
| Authors | text | Deduplicated list, e.g. `@KhaleonProductions, @staino83` |
| LastUpdated | datetime | Updated on every upsert |
| SurfaceFiles | multi-line text | Snapshot of files matched at last regen — debug aid |

Existing legacy per-PR columns stay until backfill runs and overwrites them, then a one-time cleanup script drops the unused ones.

### `backfill.mjs` — CLI

```
node backfill.mjs                    # process all features in features.yaml
node backfill.mjs --feature xero     # one feature only (dev/debug)
node backfill.mjs --resume           # skip features that already have a row
node backfill.mjs --dry-run          # log what would happen, no writes
```

No Teams card posts during backfill (only Lists upserts). Concurrency = 4.

## 5. Logic

### PR → feature matching

```
Input:  PR file list (from GitHub API)
Step 1: Load features.yaml
Step 2: For each feature, test if any surfaceGlob matches any PR file (minimatch)
Step 3: Return: { matched: [feature, ...], uncovered: [file, ...] }
```

Outcomes:
- 0 matched + 0 uncovered → skip silently (e.g. README typo)
- 0 matched + N uncovered → Teams warning, no Lists writes
- N matched (with or without uncovered) → upsert each matched feature; if uncovered exists, warning is appended to the card

### Diagram generation (per feature, both flows)

```
1. Read all files in feature.surfaceGlobs from the relevant commit
   (backfill: HEAD; per-PR: PR head SHA)
2. Concatenate into a single context blob with file path delimiters
3. Claude SDK query() with outputFormat: 'json_schema':
     { summary: string,         // AI feature description
       mermaid: string }        // flowchart TD ...
4. POST to mermaid.ink → PNG bytes
5. Upload PNG to SharePoint as item attachment
6. Return { summary, mermaidSource, diagramAttachmentId }
```

R03 compliant: ambient OAuth via `CLAUDE_OAUTH_CREDS`, never `@anthropic-ai/sdk`.

### Upsert flow (Microsoft Graph against the Lists API)

```
1. GET items?filter=fields/Slug eq '<slug>' → existing item or null
2. If null: POST item → returns new itemId
   If exists: PATCH item by itemId → updates fields, replaces diagram attachment
3. For per-PR flow: read current ContributingPRs + Authors, append/merge, write back
4. Update LastUpdated = now
```

### Diagram-failure handling

The one place errors are not swallowed:

- Claude call fails → retry once with backoff. Still fails → **abort upsert**, post Teams warning, exit non-zero.
- mermaid.ink returns non-200 or invalid PNG → retry once with simplified mermaid (strip styles). Still fails → abort, warn.
- SharePoint attachment upload fails → retry once. Still fails → abort, warn.
- Going-forward: GitHub Action exits non-zero on diagram failure → marks PR check failed → forces investigation.
- Backfill: more lenient — logs failures to `backfill-errors.json`, continues, you re-run with `--feature <slug>` after fixing.

## 6. Testing

### Unit tests (Jest, in `pr-teams-notifier/test/`)

**`featureMatcher.test.js`** — pure-function tests, no network:
- Single feature matches single PR file
- Multiple features match (overlapping globs)
- 0 matched + uncovered files → returns warning shape
- Glob edge cases (negation, double-star, exact path)

**`upsertPlanner.test.js`** — also pure:
- Upsert against existing row → produces PATCH payload
- Upsert against missing row → produces POST payload
- ContributingPRs append: dedupes if PR # already in list (idempotent re-runs)
- Authors merge: adds new author, no duplicates

### Integration tests (manual, scripted)

**`scripts/test-diagram-roundtrip.mjs`** — full diagram path against a real feature, no SharePoint write. Produces a local PNG to eyeball quality.

**`scripts/test-list-roundtrip.mjs`** — POST + PATCH cycle against a dedicated test list (separate from production). Smoke-tests credentials and Graph permissions.

### End-to-end test (smoke PR pattern)

The existing pattern (PRs `staino83/business_brain#309`, `#314` — empty marker file PRs) is kept as the e2e test. After the pipeline fix lands, opening one against `feature/auto-doc-lists-tab` should produce a card + Lists row within ~60s. Procedure documented in `docs/SMOKE_TEST.md`.

### Backfill verification

After backfill:
- Row count in Lists tab = feature count in `features.yaml` (assert)
- Spot-check 5 features: diagram renders, summary readable, contributing PRs correct
- `backfill-errors.json` is empty or reviewed

### Explicitly not tested

- Claude SDK output content (stochastic — only assert "something came back")
- mermaid.ink rendering (third-party — only assert "PNG returned, > 0 bytes")
- Bot Framework auth (covered by `business_brain` tests)

## 7. Prerequisite: pipeline fix

Before any of the above can run, this must land:

1. In `pr-teams-notifier`: merge `feature/auto-doc-lists-tab` → `master`. This makes the new reusable workflow (with all 13 secret declarations) live, unblocking the caller in `business_brain`.
2. Pin `business_brain/.github/workflows/pr-notify.yml` to a tagged version of the reusable workflow (e.g. `@v1.0.0`) instead of `@master`. Avoids future drift surprises.
3. Re-trigger PR #314 (close + reopen, or open a new smoke PR) to confirm green run.

These three steps unblock R27 entirely, even before any of the per-feature catalog work. Worth landing first as a separate PR.

## 8. Out of scope

- A separate "system architecture" mega-diagram showing all features at once. The catalog is per-feature; cross-feature relationships are not modelled.
- Changing `featureRegistry.ts` in `business_brain`. The auto-doc inventory (`features.yaml` in `pr-teams-notifier`) is independent — it can include infrastructure features (mcpToolServer, errorBus, etc.) that aren't in `featureRegistry.ts`.
- Approval workflow before publishing a row. Any PR that opens triggers an upsert; the user explicitly chose "every PR no matter how small or large" gets documented.
- Auto-detection of new features (PR touches files not in any glob → just a warning, not an automatic features.yaml entry).

## 9. Open questions

None blocking. Implementation plan can proceed.
