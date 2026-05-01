# Feature-Grouped Auto-Doc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make R27 auto-doc actually fire on every PR (per-feature upsert) and backfill the Feature Docs Lists tab with one row per existing feature in `business_brain`.

**Architecture:** Refactor the monolithic `notify.js` into focused modules (`featureMatcher`, `upsertPlanner`, `diagramGenerator`, `sharepointClient`, `githubClient`). Add `features.yaml` as the load-bearing inventory. Add `backfill.mjs` as a one-shot orchestrator that reuses the same modules.

**Tech Stack:** Node 24, ES modules, `@anthropic-ai/claude-agent-sdk` (existing), `minimatch` (new), `js-yaml` (new), `jest` (new, dev). Microsoft Graph API for Lists + Bot Framework for Teams cards (both already wired in `notify.js`).

**Spec:** `docs/superpowers/specs/2026-05-01-feature-grouped-auto-doc-design.md`

---

## File structure

**Modules to create (`pr-teams-notifier/src/`):**
- `featureInventory.js` — loads + validates `features.yaml`
- `featureMatcher.js` — pure: PR file list → matched features + uncovered files
- `upsertPlanner.js` — pure: builds POST/PATCH payloads, dedupes ContributingPRs/Authors
- `diagramGenerator.js` — Claude SDK + mermaid.ink (extracted from `notify.js`)
- `sharepointClient.js` — Graph API: GET-by-slug, POST item, PATCH item, upload attachment (extracted + extended from `notify.js`)
- `githubClient.js` — list merged PRs, get PR file list (extracted from `notify.js`)
- `surfaceReader.js` — reads files matching surfaceGlobs from a given commit/HEAD

**Files to create (root):**
- `features.yaml` — feature inventory (~30 entries)
- `backfill.mjs` — CLI orchestrator
- `docs/SMOKE_TEST.md` — how to run end-to-end smoke
- `test/featureInventory.test.js`
- `test/featureMatcher.test.js`
- `test/upsertPlanner.test.js`
- `scripts/test-diagram-roundtrip.mjs`
- `scripts/test-list-roundtrip.mjs`

**Files to modify:**
- `notify.js` — refactor to use new modules, replace single-card flow with per-feature upsert loop
- `package.json` — add deps: `minimatch`, `js-yaml`, `jest`. Update test script.
- `.github/workflows/reusable-pr-notify.yml` — already current on `feature/auto-doc-lists-tab`; no change needed

**Files in `business_brain` (separate PR):**
- `.github/workflows/pr-notify.yml` — pin reusable workflow ref to a tag (e.g. `@v1.0.0`) instead of `@master`
- `docs/UNIVERSAL_RULES.md` — small text update to R27 reflecting upsert behavior

---

## Phase 0: Pipeline fix (prerequisite, no code)

Must land before any per-feature work, otherwise smoke tests can't validate.

### Task 0.1: Merge feature/auto-doc-lists-tab → master in pr-teams-notifier

**Files:** none (git operation only)

- [ ] **Step 1: Confirm local branch is up to date with remote**

```bash
cd c:/code/pr-teams-notifier
git fetch origin
git checkout feature/auto-doc-lists-tab
git status   # expect: up to date with origin/feature/auto-doc-lists-tab
```

- [ ] **Step 2: Open a PR from feature/auto-doc-lists-tab → master on the pr-teams-notifier repo**

```bash
gh pr create --repo KhaleonProductions/pr-teams-notifier \
  --base master --head feature/auto-doc-lists-tab \
  --title "Auto-doc Feature Docs Lists tab — Bot Framework + Claude SDK + mermaid.ink" \
  --body "Lands the implementation behind R27. Replaces legacy webhook-only notify.js with the per-PR auto-doc flow."
```

- [ ] **Step 3: Merge the PR**

```bash
gh pr merge --repo KhaleonProductions/pr-teams-notifier --squash --auto
```

Expected: master now has the updated reusable workflow declaring all 13 secrets.

- [ ] **Step 4: Tag v1.0.0 on master**

```bash
cd c:/code/pr-teams-notifier
git checkout master
git pull origin master
git tag -a v1.0.0 -m "Initial release: Bot Framework + Claude SDK + Lists auto-doc"
git push origin v1.0.0
```

### Task 0.2: Pin business_brain caller to v1.0.0

**Files:**
- Modify: `business_brain/.github/workflows/pr-notify.yml:35`

- [ ] **Step 1: Edit the uses: ref**

```yaml
# OLD
uses: KhaleonProductions/pr-teams-notifier/.github/workflows/reusable-pr-notify.yml@master
# NEW
uses: KhaleonProductions/pr-teams-notifier/.github/workflows/reusable-pr-notify.yml@v1.0.0
```

- [ ] **Step 2: Commit on a feature branch in business_brain**

```bash
cd c:/code/the\ everything/business_brain
git checkout -b chore/pin-pr-notifier-to-v1
git add .github/workflows/pr-notify.yml
git commit -m "chore(ci): pin pr-teams-notifier reusable workflow to v1.0.0"
```

- [ ] **Step 3: Push, open PR, merge after green smoke**

(Manual — Scott decides when to merge.)

### Task 0.3: Re-trigger smoke test PR #314

- [ ] **Step 1: Close + reopen PR #314 to retrigger workflow**

```bash
gh pr close --repo staino83/business_brain 314
gh pr reopen --repo staino83/business_brain 314
```

- [ ] **Step 2: Watch the workflow**

```bash
gh run watch --repo staino83/business_brain --exit-status
```

Expected: green run, Teams card appears in "feature docs" channel within 60s.

---

## Phase 1: Feature inventory + matcher

Foundation for everything else. Pure logic, fully unit-tested.

### Task 1.1: Add deps and Jest config

**Files:**
- Modify: `pr-teams-notifier/package.json`
- Create: `pr-teams-notifier/jest.config.js`

- [ ] **Step 1: Add deps**

```bash
cd c:/code/pr-teams-notifier
npm install minimatch js-yaml
npm install --save-dev jest @jest/globals
```

- [ ] **Step 2: Update package.json scripts**

Replace the `scripts` block:

```json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch",
  "notify": "node notify.js"
}
```

- [ ] **Step 3: Create jest.config.js (ESM)**

```js
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['<rootDir>/test/**/*.test.js'],
};
```

- [ ] **Step 4: Verify jest runs**

```bash
npx jest --listTests
```

Expected: prints "No tests found" without crashing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json jest.config.js
git commit -m "chore: add jest, minimatch, js-yaml for feature-grouped auto-doc"
```

### Task 1.2: features.yaml — initial inventory

**Files:**
- Create: `pr-teams-notifier/features.yaml`

- [ ] **Step 1: Create features.yaml with starter entries**

Use this exact content (covers the features visible from the `business_brain` repo's `services/` and `cards/` dirs — extend later):

```yaml
# Feature inventory for R27 auto-doc.
# Each entry produces one row in the SharePoint Feature Docs list.
# surfaceGlobs match against PR file lists (minimatch syntax).

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

  - slug: bookkeeper
    displayName: Bookkeeper agent
    description: Browser-based bookkeeping automation against Xero UI.
    surfaceGlobs:
      - teams_bot/src/services/bookkeeper/**
      - "!teams_bot/src/services/bookkeeper/xero*.ts"

  - slug: trak-integration
    displayName: Trak integration
    description: Trak API client + sync workers + SMS monitor.
    surfaceGlobs:
      - teams_bot/src/services/trakIntegration/**
      - "!teams_bot/src/services/trakIntegration/xeroGate.ts"

  - slug: feature-registry
    displayName: Feature registry
    description: Per-tenant feature flags + manage_features MCP tool.
    surfaceGlobs:
      - teams_bot/src/services/featureRegistry.ts
      - teams_bot/src/db/featureRegistry.ts

  # NOTE: starter set. Add remaining features (proactiveIntelligence,
  # mcpToolServer, errorBus, etc.) before backfill runs.
```

- [ ] **Step 2: Commit**

```bash
git add features.yaml
git commit -m "feat(inventory): seed features.yaml with starter feature surface globs"
```

### Task 1.3: featureInventory module + tests (TDD)

**Files:**
- Create: `pr-teams-notifier/src/featureInventory.js`
- Create: `pr-teams-notifier/test/featureInventory.test.js`
- Test: same

- [ ] **Step 1: Write the failing tests**

```js
// test/featureInventory.test.js
import { jest } from '@jest/globals';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadFeatureInventory } from '../src/featureInventory.js';

const tmpYaml = (content) => {
  const path = join(tmpdir(), `features-${Date.now()}.yaml`);
  writeFileSync(path, content, 'utf-8');
  return path;
};

describe('loadFeatureInventory', () => {
  test('parses a valid yaml with one feature', () => {
    const path = tmpYaml(`
features:
  - slug: xero
    displayName: Xero
    description: Xero integration
    surfaceGlobs:
      - src/xero/**
`);
    const inv = loadFeatureInventory(path);
    expect(inv).toHaveLength(1);
    expect(inv[0].slug).toBe('xero');
    expect(inv[0].surfaceGlobs).toEqual(['src/xero/**']);
    unlinkSync(path);
  });

  test('throws if a feature is missing slug', () => {
    const path = tmpYaml(`
features:
  - displayName: NoSlug
    surfaceGlobs: [src/**]
`);
    expect(() => loadFeatureInventory(path)).toThrow(/slug/);
    unlinkSync(path);
  });

  test('throws if two features share a slug', () => {
    const path = tmpYaml(`
features:
  - slug: a
    displayName: A
    surfaceGlobs: [src/a/**]
  - slug: a
    displayName: A2
    surfaceGlobs: [src/a2/**]
`);
    expect(() => loadFeatureInventory(path)).toThrow(/duplicate slug/);
    unlinkSync(path);
  });

  test('throws if surfaceGlobs is empty', () => {
    const path = tmpYaml(`
features:
  - slug: empty
    displayName: Empty
    surfaceGlobs: []
`);
    expect(() => loadFeatureInventory(path)).toThrow(/surfaceGlobs/);
    unlinkSync(path);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/featureInventory.test.js
```

Expected: 4 tests fail with "Cannot find module '../src/featureInventory.js'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/featureInventory.js
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

export function loadFeatureInventory(path) {
  const raw = readFileSync(path, 'utf-8');
  const parsed = yaml.load(raw);
  const features = parsed?.features ?? [];

  const slugs = new Set();
  for (const f of features) {
    if (!f.slug) throw new Error(`Feature missing slug: ${JSON.stringify(f)}`);
    if (slugs.has(f.slug)) throw new Error(`duplicate slug: ${f.slug}`);
    slugs.add(f.slug);
    if (!Array.isArray(f.surfaceGlobs) || f.surfaceGlobs.length === 0) {
      throw new Error(`Feature ${f.slug}: surfaceGlobs must be a non-empty array`);
    }
  }
  return features;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/featureInventory.test.js
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/featureInventory.js test/featureInventory.test.js
git commit -m "feat(inventory): loadFeatureInventory with validation"
```

### Task 1.4: featureMatcher module + tests (TDD)

**Files:**
- Create: `pr-teams-notifier/src/featureMatcher.js`
- Create: `pr-teams-notifier/test/featureMatcher.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/featureMatcher.test.js
import { matchPRFiles } from '../src/featureMatcher.js';

const inv = [
  {
    slug: 'xero',
    surfaceGlobs: [
      'teams_bot/src/cards/xeroOnboardingCard.ts',
      'teams_bot/src/services/bookkeeper/xero*.ts',
    ],
  },
  {
    slug: 'gate-engine',
    surfaceGlobs: ['teams_bot/src/services/gateEngine/**'],
  },
];

describe('matchPRFiles', () => {
  test('exact path match', () => {
    const res = matchPRFiles(['teams_bot/src/cards/xeroOnboardingCard.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
    expect(res.uncovered).toEqual([]);
  });

  test('glob match (xero* prefix)', () => {
    const res = matchPRFiles(['teams_bot/src/services/bookkeeper/xeroApi.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
  });

  test('double-star match', () => {
    const res = matchPRFiles(['teams_bot/src/services/gateEngine/digest.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['gate-engine']);
  });

  test('multiple features match (one PR, two features)', () => {
    const res = matchPRFiles(
      [
        'teams_bot/src/cards/xeroOnboardingCard.ts',
        'teams_bot/src/services/gateEngine/digest.ts',
      ],
      inv
    );
    expect(res.matched.map((f) => f.slug).sort()).toEqual(['gate-engine', 'xero']);
    expect(res.uncovered).toEqual([]);
  });

  test('uncovered file', () => {
    const res = matchPRFiles(['README.md'], inv);
    expect(res.matched).toEqual([]);
    expect(res.uncovered).toEqual(['README.md']);
  });

  test('mixed: matched + uncovered', () => {
    const res = matchPRFiles(
      ['teams_bot/src/cards/xeroOnboardingCard.ts', 'README.md'],
      inv
    );
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
    expect(res.uncovered).toEqual(['README.md']);
  });

  test('returns each feature at most once even if multiple files match', () => {
    const res = matchPRFiles(
      [
        'teams_bot/src/cards/xeroOnboardingCard.ts',
        'teams_bot/src/services/bookkeeper/xeroApi.ts',
      ],
      inv
    );
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].slug).toBe('xero');
  });

  test('negation glob (!) excludes a path', () => {
    const inv2 = [
      {
        slug: 'bookkeeper',
        surfaceGlobs: [
          'teams_bot/src/services/bookkeeper/**',
          '!teams_bot/src/services/bookkeeper/xero*.ts',
        ],
      },
    ];
    const xero = matchPRFiles(['teams_bot/src/services/bookkeeper/xeroApi.ts'], inv2);
    const other = matchPRFiles(['teams_bot/src/services/bookkeeper/scraper-v2.ts'], inv2);
    expect(xero.matched).toEqual([]);
    expect(xero.uncovered).toEqual(['teams_bot/src/services/bookkeeper/xeroApi.ts']);
    expect(other.matched.map((f) => f.slug)).toEqual(['bookkeeper']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/featureMatcher.test.js
```

Expected: 8 tests fail with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```js
// src/featureMatcher.js
import { minimatch } from 'minimatch';

function fileMatchesGlobs(file, globs) {
  // Apply globs in order, with negation support: !pattern excludes.
  // If no positive glob matches, return false.
  // If a positive matches but a later negative excludes, return false.
  let matched = false;
  for (const g of globs) {
    if (g.startsWith('!')) {
      if (minimatch(file, g.slice(1))) matched = false;
    } else {
      if (minimatch(file, g)) matched = true;
    }
  }
  return matched;
}

export function matchPRFiles(files, inventory) {
  const matchedFeatures = new Map(); // slug -> feature
  const uncovered = [];

  for (const file of files) {
    let fileMatched = false;
    for (const feature of inventory) {
      if (fileMatchesGlobs(file, feature.surfaceGlobs)) {
        matchedFeatures.set(feature.slug, feature);
        fileMatched = true;
      }
    }
    if (!fileMatched) uncovered.push(file);
  }

  return {
    matched: Array.from(matchedFeatures.values()),
    uncovered,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/featureMatcher.test.js
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/featureMatcher.js test/featureMatcher.test.js
git commit -m "feat(matcher): PR file → feature matching with minimatch + negation"
```

### Task 1.5: upsertPlanner module + tests (TDD)

**Files:**
- Create: `pr-teams-notifier/src/upsertPlanner.js`
- Create: `pr-teams-notifier/test/upsertPlanner.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/upsertPlanner.test.js
import { planUpsert, mergeContributingPRs, mergeAuthors } from '../src/upsertPlanner.js';

describe('mergeContributingPRs', () => {
  test('appends new PR line', () => {
    const existing = '#100 — first PR — @alice (2026-01-01)';
    const newLine = '#101 — second PR — @bob (2026-01-02)';
    expect(mergeContributingPRs(existing, newLine)).toBe(
      `${existing}\n${newLine}`
    );
  });

  test('dedupes by PR number (idempotent re-run)', () => {
    const existing = '#100 — first PR — @alice (2026-01-01)';
    const newLine = '#100 — first PR retitled — @alice (2026-01-02)';
    expect(mergeContributingPRs(existing, newLine)).toBe(existing);
  });

  test('handles empty existing', () => {
    expect(mergeContributingPRs('', '#100 — x — @a (2026-01-01)')).toBe(
      '#100 — x — @a (2026-01-01)'
    );
    expect(mergeContributingPRs(null, '#100 — x — @a (2026-01-01)')).toBe(
      '#100 — x — @a (2026-01-01)'
    );
  });
});

describe('mergeAuthors', () => {
  test('adds new author', () => {
    expect(mergeAuthors('@alice', '@bob')).toBe('@alice, @bob');
  });
  test('dedupes existing author', () => {
    expect(mergeAuthors('@alice, @bob', '@alice')).toBe('@alice, @bob');
  });
  test('empty existing', () => {
    expect(mergeAuthors('', '@alice')).toBe('@alice');
    expect(mergeAuthors(null, '@alice')).toBe('@alice');
  });
});

describe('planUpsert', () => {
  const baseFields = {
    title: 'Xero',
    slug: 'xero',
    description: 'Xero stuff',
    diagramSource: 'flowchart TD\nA-->B',
    surfaceFiles: 'a.ts\nb.ts',
  };

  test('produces POST plan when no existing item', () => {
    const plan = planUpsert({
      existingItem: null,
      featureFields: baseFields,
      contributingPRLine: '#1 — init — @alice (2026-01-01)',
      author: '@alice',
    });
    expect(plan.method).toBe('POST');
    expect(plan.fields.Slug).toBe('xero');
    expect(plan.fields.ContributingPRs).toBe('#1 — init — @alice (2026-01-01)');
    expect(plan.fields.Authors).toBe('@alice');
    expect(plan.fields.LastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('produces PATCH plan when existing item present, merges PR list and authors', () => {
    const plan = planUpsert({
      existingItem: {
        id: 42,
        fields: {
          ContributingPRs: '#1 — init — @alice (2026-01-01)',
          Authors: '@alice',
        },
      },
      featureFields: baseFields,
      contributingPRLine: '#2 — fix — @bob (2026-01-02)',
      author: '@bob',
    });
    expect(plan.method).toBe('PATCH');
    expect(plan.itemId).toBe(42);
    expect(plan.fields.ContributingPRs).toBe(
      '#1 — init — @alice (2026-01-01)\n#2 — fix — @bob (2026-01-02)'
    );
    expect(plan.fields.Authors).toBe('@alice, @bob');
  });

  test('idempotent: re-running same PR does not duplicate', () => {
    const plan = planUpsert({
      existingItem: {
        id: 42,
        fields: {
          ContributingPRs: '#1 — init — @alice (2026-01-01)',
          Authors: '@alice',
        },
      },
      featureFields: baseFields,
      contributingPRLine: '#1 — init — @alice (2026-01-01)',
      author: '@alice',
    });
    expect(plan.fields.ContributingPRs).toBe('#1 — init — @alice (2026-01-01)');
    expect(plan.fields.Authors).toBe('@alice');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/upsertPlanner.test.js
```

Expected: tests fail with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```js
// src/upsertPlanner.js

export function mergeContributingPRs(existing, newLine) {
  if (!existing) return newLine;
  const prNumberOf = (line) => {
    const m = line.match(/^#(\d+)\b/);
    return m ? m[1] : null;
  };
  const newPR = prNumberOf(newLine);
  const lines = existing.split('\n');
  if (newPR && lines.some((l) => prNumberOf(l) === newPR)) {
    return existing;
  }
  return `${existing}\n${newLine}`;
}

export function mergeAuthors(existing, author) {
  if (!existing) return author;
  const set = new Set(existing.split(',').map((s) => s.trim()).filter(Boolean));
  set.add(author);
  return Array.from(set).join(', ');
}

export function planUpsert({ existingItem, featureFields, contributingPRLine, author }) {
  const now = new Date().toISOString();

  const existingPRs = existingItem?.fields?.ContributingPRs ?? '';
  const existingAuthors = existingItem?.fields?.Authors ?? '';

  const fields = {
    Title: featureFields.title,
    Slug: featureFields.slug,
    Description: featureFields.description,
    DiagramSource: featureFields.diagramSource,
    SurfaceFiles: featureFields.surfaceFiles,
    ContributingPRs: mergeContributingPRs(existingPRs, contributingPRLine),
    Authors: mergeAuthors(existingAuthors, author),
    LastUpdated: now,
  };

  if (existingItem) {
    return { method: 'PATCH', itemId: existingItem.id, fields };
  }
  return { method: 'POST', fields };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/upsertPlanner.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/upsertPlanner.js test/upsertPlanner.test.js
git commit -m "feat(planner): pure upsert payload + dedup PRs/authors"
```

---

## Phase 2: Diagram generator

Extracts the existing `aiGenerate` + `buildDiagramUrl` from `notify.js` into a focused module that takes a feature surface (not PR data) and returns `{ summary, mermaid, pngBuffer }`.

### Task 2.1: surfaceReader module + tests

**Files:**
- Create: `pr-teams-notifier/src/surfaceReader.js`
- Create: `pr-teams-notifier/test/surfaceReader.test.js`

- [ ] **Step 1: Write the failing test (uses git ls-files via execSync; small fixture repo)**

```js
// test/surfaceReader.test.js
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readSurfaceFiles } from '../src/surfaceReader.js';

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'surface-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email x@x', { cwd: dir });
  execSync('git config user.name x', { cwd: dir });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;');
  writeFileSync(join(dir, 'src/b.ts'), 'export const b = 2;');
  writeFileSync(join(dir, 'README.md'), '# x');
  execSync('git add . && git commit -q -m init', { cwd: dir });
  return dir;
}

describe('readSurfaceFiles', () => {
  test('returns matching files with content from HEAD', () => {
    const repo = mkRepo();
    const result = readSurfaceFiles({
      repoDir: repo,
      ref: 'HEAD',
      globs: ['src/**'],
    });
    expect(result.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result[0].content).toMatch(/export const/);
  });

  test('respects negation', () => {
    const repo = mkRepo();
    const result = readSurfaceFiles({
      repoDir: repo,
      ref: 'HEAD',
      globs: ['src/**', '!src/b.ts'],
    });
    expect(result.map((f) => f.path)).toEqual(['src/a.ts']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
npx jest test/surfaceReader.test.js
```

- [ ] **Step 3: Implement**

```js
// src/surfaceReader.js
import { execSync } from 'child_process';
import { minimatch } from 'minimatch';

export function readSurfaceFiles({ repoDir, ref = 'HEAD', globs }) {
  const lsOutput = execSync(`git ls-tree -r --name-only ${ref}`, {
    cwd: repoDir,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const allFiles = lsOutput.trim().split('\n').filter(Boolean);

  const matches = (file) => {
    let m = false;
    for (const g of globs) {
      if (g.startsWith('!')) {
        if (minimatch(file, g.slice(1))) m = false;
      } else {
        if (minimatch(file, g)) m = true;
      }
    }
    return m;
  };

  const matched = allFiles.filter(matches);
  return matched.map((path) => ({
    path,
    content: execSync(`git show ${ref}:"${path}"`, {
      cwd: repoDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }),
  }));
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/surfaceReader.js test/surfaceReader.test.js
git commit -m "feat(surface): read files matching globs from a git ref"
```

### Task 2.2: diagramGenerator module (extract from notify.js, no unit tests — integration smoke instead)

**Files:**
- Create: `pr-teams-notifier/src/diagramGenerator.js`

Reason for no unit tests: the only logic is "call Claude SDK, call mermaid.ink." Both are external. The smoke script in Task 2.3 covers it.

- [ ] **Step 1: Create the module by extracting notify.js:184-303**

```js
// src/diagramGenerator.js
import { query } from '@anthropic-ai/claude-agent-sdk';

const FEATURE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'A 2-4 sentence description of what this feature does and how its parts connect.',
    },
    mermaid: {
      type: 'string',
      description:
        'A Mermaid `flowchart TD` (top-down) showing the feature\'s components and data flow. Use simple node IDs and short labels. No styling/classDef.',
    },
  },
  required: ['summary', 'mermaid'],
};

export async function generateFeatureDiagram({ feature, surfaceFiles }) {
  const surfaceBlob = surfaceFiles
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const prompt = `You are documenting a software feature for an engineering catalog.

Feature: ${feature.displayName} (slug: ${feature.slug})
Stated description: ${feature.description ?? '(none)'}

Below is the full source code of every file in this feature's surface:

${surfaceBlob}

Produce a JSON object with:
- "summary": 2-4 sentences. What does this feature do? How do the files connect?
- "mermaid": a Mermaid flowchart TD showing the components and the data flow between them. Use the actual file/module names. Keep it under 15 nodes.`;

  const response = await query({
    prompt,
    options: {
      outputFormat: 'json_schema',
      jsonSchema: FEATURE_SUMMARY_SCHEMA,
    },
  });

  const result = JSON.parse(response.text);

  // Render Mermaid -> PNG via mermaid.ink
  const encoded = Buffer.from(result.mermaid).toString('base64url');
  const url = `https://mermaid.ink/img/${encoded}?type=png`;
  const pngResponse = await fetch(url);
  if (!pngResponse.ok) {
    throw new Error(`mermaid.ink returned ${pngResponse.status}: ${await pngResponse.text()}`);
  }
  const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
  if (pngBuffer.length === 0) {
    throw new Error('mermaid.ink returned empty PNG');
  }

  return {
    summary: result.summary,
    mermaid: result.mermaid,
    pngBuffer,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/diagramGenerator.js
git commit -m "feat(diagram): per-feature diagram generation via Claude SDK + mermaid.ink"
```

### Task 2.3: scripts/test-diagram-roundtrip.mjs (smoke harness)

**Files:**
- Create: `pr-teams-notifier/scripts/test-diagram-roundtrip.mjs`

- [ ] **Step 1: Implement**

```js
// scripts/test-diagram-roundtrip.mjs
// Usage: node scripts/test-diagram-roundtrip.mjs --feature xero --repo c:/code/the\ everything/business_brain --out tmp/xero.png

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { loadFeatureInventory } from '../src/featureInventory.js';
import { readSurfaceFiles } from '../src/surfaceReader.js';
import { generateFeatureDiagram } from '../src/diagramGenerator.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, val, i, arr) => {
    if (val.startsWith('--')) acc.push([val.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

if (!args.feature || !args.repo || !args.out) {
  console.error('Usage: --feature <slug> --repo <path> --out <pngPath>');
  process.exit(1);
}

const inventory = loadFeatureInventory('features.yaml');
const feature = inventory.find((f) => f.slug === args.feature);
if (!feature) {
  console.error(`No feature with slug "${args.feature}"`);
  process.exit(1);
}

const surfaceFiles = readSurfaceFiles({
  repoDir: args.repo,
  ref: 'HEAD',
  globs: feature.surfaceGlobs,
});
console.log(`Surface: ${surfaceFiles.length} files`);

const { summary, mermaid, pngBuffer } = await generateFeatureDiagram({
  feature,
  surfaceFiles,
});

console.log('--- Summary ---');
console.log(summary);
console.log('--- Mermaid ---');
console.log(mermaid);

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, pngBuffer);
console.log(`Wrote ${pngBuffer.length} bytes to ${args.out}`);
```

- [ ] **Step 2: Run smoke locally**

```bash
cd c:/code/pr-teams-notifier
# Requires CLAUDE_OAUTH_CREDS already provisioned at ~/.claude/.credentials.json
node scripts/test-diagram-roundtrip.mjs --feature xero \
  --repo "c:/code/the everything/business_brain" \
  --out tmp/xero.png
```

Expected: prints summary + mermaid; writes a non-empty `tmp/xero.png` you can open and visually inspect.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-diagram-roundtrip.mjs
git commit -m "test(diagram): smoke harness for end-to-end diagram generation"
```

---

## Phase 3: SharePoint upsert client

Extract + extend the existing `getGraphToken` / `postListItem` from `notify.js` into a module that supports GET-by-slug, POST, PATCH, and attachment upload.

### Task 3.1: sharepointClient module

**Files:**
- Create: `pr-teams-notifier/src/sharepointClient.js`

- [ ] **Step 1: Implement**

```js
// src/sharepointClient.js

const GRAPH = 'https://graph.microsoft.com/v1.0';

export async function getGraphToken({ tenantId, clientId, clientSecret }) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token failure: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

export async function findItemBySlug({ token, siteId, listId, slug }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items?expand=fields&$filter=fields/Slug eq '${slug}'`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
  });
  if (!res.ok) throw new Error(`findItemBySlug ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.value?.[0] ?? null;
}

export async function createItem({ token, siteId, listId, fields }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`createItem ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function patchItem({ token, siteId, listId, itemId, fields }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items/${itemId}/fields`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`patchItem ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function uploadAttachment({ token, siteId, listId, itemId, filename, pngBuffer }) {
  // SharePoint Lists items support attachments via the parent list's drive.
  // Path: /sites/{siteId}/lists/{listId}/items/{itemId}/driveItem/children/{filename}/content
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items/${itemId}/driveItem:/Attachments/${filename}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: pngBuffer,
  });
  if (!res.ok) throw new Error(`uploadAttachment ${res.status}: ${await res.text()}`);
  return await res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sharepointClient.js
git commit -m "feat(sharepoint): client with find-by-slug, create, patch, attachment upload"
```

### Task 3.2: scripts/test-list-roundtrip.mjs (smoke harness)

**Files:**
- Create: `pr-teams-notifier/scripts/test-list-roundtrip.mjs`

- [ ] **Step 1: Implement**

```js
// scripts/test-list-roundtrip.mjs
// Tests POST + GET-by-slug + PATCH against a TEST list (not production).
// Required env: AZURE_TENANT_ID, AZURE_CONTENT_CLIENT_ID, AZURE_CONTENT_CLIENT_SECRET,
//               TEST_LISTS_SITE_ID, TEST_LISTS_LIST_ID

import {
  getGraphToken,
  findItemBySlug,
  createItem,
  patchItem,
} from '../src/sharepointClient.js';

const env = (k) => {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
  return process.env[k];
};

const token = await getGraphToken({
  tenantId: env('AZURE_TENANT_ID'),
  clientId: env('AZURE_CONTENT_CLIENT_ID'),
  clientSecret: env('AZURE_CONTENT_CLIENT_SECRET'),
});

const siteId = env('TEST_LISTS_SITE_ID');
const listId = env('TEST_LISTS_LIST_ID');
const slug = `roundtrip-${Date.now()}`;

console.log('1. CREATE');
const created = await createItem({
  token,
  siteId,
  listId,
  fields: { Title: 'Roundtrip', Slug: slug, Description: 'initial' },
});
console.log(`  itemId=${created.id}`);

console.log('2. FIND by slug');
const found = await findItemBySlug({ token, siteId, listId, slug });
if (!found || found.id !== created.id) throw new Error('find-by-slug mismatch');
console.log('  OK');

console.log('3. PATCH');
await patchItem({
  token,
  siteId,
  listId,
  itemId: created.id,
  fields: { Description: 'updated' },
});
console.log('  OK');

const re = await findItemBySlug({ token, siteId, listId, slug });
if (re.fields.Description !== 'updated') throw new Error('patch did not stick');
console.log('All operations OK.');
```

- [ ] **Step 2: Run against a test list (Scott provides TEST_LISTS_SITE_ID/_LIST_ID)**

- [ ] **Step 3: Commit**

```bash
git add scripts/test-list-roundtrip.mjs
git commit -m "test(sharepoint): smoke harness for create/find/patch roundtrip"
```

---

## Phase 4: notify.js refactor (going-forward upsert)

Replace the existing single-card-per-PR flow with the per-feature upsert loop. Bot Framework card posting stays.

### Task 4.1: githubClient module (extract list-PRs + get-PR-files)

**Files:**
- Create: `pr-teams-notifier/src/githubClient.js`

- [ ] **Step 1: Implement**

```js
// src/githubClient.js

const GH = 'https://api.github.com';

function ghHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function getPRFiles({ token, owner, repo, prNumber }) {
  const url = `${GH}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`getPRFiles ${res.status}: ${await res.text()}`);
  const files = await res.json();
  return files.map((f) => f.filename);
}

export async function* listMergedPRs({ token, owner, repo }) {
  // Yields PRs newest-first. Caller can reverse for chronological backfill.
  let page = 1;
  while (true) {
    const url = `${GH}/repos/${owner}/${repo}/pulls?state=closed&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`listMergedPRs page ${page} ${res.status}: ${await res.text()}`);
    const prs = await res.json();
    if (prs.length === 0) return;
    for (const pr of prs) {
      if (pr.merged_at) {
        yield {
          number: pr.number,
          title: pr.title,
          author: pr.user?.login,
          mergedAt: pr.merged_at,
          mergeCommitSha: pr.merge_commit_sha,
        };
      }
    }
    page += 1;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/githubClient.js
git commit -m "feat(github): client for PR file list + merged PR enumeration"
```

### Task 4.2: Refactor notify.js to use modules + per-feature upsert

**Files:**
- Modify: `pr-teams-notifier/notify.js` (full rewrite)

- [ ] **Step 1: Rewrite notify.js**

This replaces the existing 645-line `notify.js`. Keep the env-var contract (PR_URL, PR_TITLE, etc.) so the GH Action interface doesn't change. Reuse `buildCard` from the old version for the Bot Framework post.

```js
// notify.js
// Per-feature upsert flow for R27 auto-doc.
// Reads PR data from env (or PR_JSON), matches files to features.yaml,
// regenerates each touched feature's diagram, upserts to SharePoint Lists,
// posts a single summary card to the Teams "feature docs" channel.

import { existsSync } from 'fs';
import { loadFeatureInventory } from './src/featureInventory.js';
import { matchPRFiles } from './src/featureMatcher.js';
import { readSurfaceFiles } from './src/surfaceReader.js';
import { generateFeatureDiagram } from './src/diagramGenerator.js';
import { planUpsert } from './src/upsertPlanner.js';
import {
  getGraphToken,
  findItemBySlug,
  createItem,
  patchItem,
  uploadAttachment,
} from './src/sharepointClient.js';
import { getPRFiles } from './src/githubClient.js';
// Bot Framework helpers (kept from the old notify.js — see Task 4.3)
import {
  getBotFrameworkToken,
  postChannelCardViaBotFramework,
} from './src/botFrameworkClient.js';

const env = (k, def) => process.env[k] ?? def;

async function loadPRData() {
  if (process.env.PR_JSON) {
    const pr = JSON.parse(process.env.PR_JSON);
    return {
      number: pr.number,
      title: pr.title,
      author: pr.author?.login ?? 'unknown',
      url: pr.url,
      repo: pr.headRepository?.nameWithOwner ?? env('PR_REPO'),
      headSha: pr.headRefOid,
      files: (pr.files ?? []).map((f) => f.path),
      mergedAt: pr.mergedAt,
    };
  }
  // Default: pull from GH Action env + GH API for files
  const repo = env('PR_REPO');
  const number = parseInt(env('PR_NUMBER'), 10);
  const ghToken = env('GITHUB_TOKEN');
  const [owner, name] = repo.split('/');
  const files = await getPRFiles({ token: ghToken, owner, repo: name, prNumber: number });
  return {
    number,
    title: env('PR_TITLE'),
    author: env('PR_AUTHOR', 'unknown'),
    url: env('PR_URL'),
    repo,
    headSha: env('PR_HEAD_SHA'),
    files,
  };
}

async function main() {
  const featuresYaml = env('FEATURES_YAML', 'features.yaml');
  if (!existsSync(featuresYaml)) {
    console.error(`features.yaml not found at ${featuresYaml}`);
    process.exit(1);
  }
  const inventory = loadFeatureInventory(featuresYaml);
  const pr = await loadPRData();

  console.log(`PR #${pr.number} by @${pr.author} — ${pr.files.length} files`);

  const { matched, uncovered } = matchPRFiles(pr.files, inventory);
  console.log(`Matched: ${matched.map((f) => f.slug).join(', ') || '(none)'}`);
  console.log(`Uncovered: ${uncovered.length}`);

  if (matched.length === 0 && uncovered.length === 0) {
    console.log('No tracked files touched. Skipping.');
    return;
  }

  // Even if all files are uncovered, post a warning card (no Lists writes).
  const sharepointEnv = {
    tenantId: env('AZURE_TENANT_ID'),
    clientId: env('AZURE_CONTENT_CLIENT_ID'),
    clientSecret: env('AZURE_CONTENT_CLIENT_SECRET'),
  };
  const siteId = env('LISTS_SITE_ID');
  const listId = env('LISTS_LIST_ID');

  let token = null;
  if (matched.length > 0) {
    token = await getGraphToken(sharepointEnv);
  }

  const repoDir = env('REPO_DIR'); // for surface reading; in CI this is the checked-out repo
  const upsertResults = [];

  for (const feature of matched) {
    console.log(`\n--- ${feature.slug} ---`);
    try {
      const surfaceFiles = readSurfaceFiles({
        repoDir,
        ref: pr.headSha,
        globs: feature.surfaceGlobs,
      });
      console.log(`  ${surfaceFiles.length} surface files`);

      const { summary, mermaid, pngBuffer } = await generateFeatureDiagram({
        feature,
        surfaceFiles,
      });

      const existingItem = await findItemBySlug({
        token,
        siteId,
        listId,
        slug: feature.slug,
      });

      const prLine = `#${pr.number} — ${pr.title} — @${pr.author} (${(pr.mergedAt ?? new Date().toISOString()).slice(0, 10)})`;

      const plan = planUpsert({
        existingItem,
        featureFields: {
          title: feature.displayName,
          slug: feature.slug,
          description: summary,
          diagramSource: mermaid,
          surfaceFiles: surfaceFiles.map((f) => f.path).join('\n'),
        },
        contributingPRLine: prLine,
        author: `@${pr.author}`,
      });

      let itemId;
      if (plan.method === 'POST') {
        const created = await createItem({ token, siteId, listId, fields: plan.fields });
        itemId = created.id;
      } else {
        await patchItem({ token, siteId, listId, itemId: plan.itemId, fields: plan.fields });
        itemId = plan.itemId;
      }

      await uploadAttachment({
        token,
        siteId,
        listId,
        itemId,
        filename: `${feature.slug}.png`,
        pngBuffer,
      });

      upsertResults.push({ feature, itemId, summary, error: null });
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      upsertResults.push({ feature, error: err.message });
      // Per spec: diagram failure = abort upsert + warn + non-zero exit at end.
    }
  }

  // Post a summary card to Teams (one card per PR, listing all touched features).
  if (env('SKIP_TEAMS') !== '1') {
    const botToken = await getBotFrameworkToken({
      tenantId: env('BOT_HOME_AZURE_TENANT_ID'),
      appId: env('TEAMS_APP_ID'),
      appPassword: env('TEAMS_APP_PASSWORD'),
    });
    await postChannelCardViaBotFramework({
      token: botToken,
      teamId: env('TARGET_TEAM_ID'),
      channelId: env('TARGET_CHANNEL_ID'),
      pr,
      upsertResults,
      uncovered,
    });
  }

  const failed = upsertResults.filter((r) => r.error);
  if (failed.length > 0) {
    console.error(`\n${failed.length} feature(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add notify.js
git commit -m "refactor(notify): per-feature upsert loop using new modules"
```

### Task 4.3: Extract Bot Framework helpers into module

**Files:**
- Create: `pr-teams-notifier/src/botFrameworkClient.js`

- [ ] **Step 1: Move the `getBotFrameworkToken`, `postChannelCardViaBotFramework`, and `buildCard` functions from the old `notify.js` (lines 489-554, 349-488) into the new module.**

The new `buildCard` should accept `{ pr, upsertResults, uncovered }` instead of `{ prData, summary, diagram }`, and produce a card listing each touched feature with its summary and a link to the Lists row.

Pseudocode for the card body:

```
"PR #314 by @KhaleonProductions: Smoke test: xero app"
"Touched features:"
  • Xero accounting integration — <new summary> [View row]
  • Trak↔Xero gate — <new summary> [View row]
"Uncovered files (please add to features.yaml):"
  • some/random/file.ts
```

(Full card JSON omitted here — copy the structure from `notify.js:349-488` and adapt the body builder.)

- [ ] **Step 2: Commit**

```bash
git add src/botFrameworkClient.js
git commit -m "refactor(teams): extract Bot Framework client into module"
```

---

## Phase 5: Backfill orchestrator

### Task 5.1: backfill.mjs

**Files:**
- Create: `pr-teams-notifier/backfill.mjs`

- [ ] **Step 1: Implement**

```js
// backfill.mjs
// One-shot: walks features.yaml, generates diagram + upserts row for each.
// Walks merged PRs and adds them to ContributingPRs/Authors based on file matching.
//
// Usage:
//   node backfill.mjs                      # all features
//   node backfill.mjs --feature xero       # one feature
//   node backfill.mjs --resume             # skip features already in Lists
//   node backfill.mjs --dry-run            # log only, no writes

import { existsSync, writeFileSync } from 'fs';
import pLimit from 'p-limit';
import { loadFeatureInventory } from './src/featureInventory.js';
import { readSurfaceFiles } from './src/surfaceReader.js';
import { generateFeatureDiagram } from './src/diagramGenerator.js';
import { planUpsert } from './src/upsertPlanner.js';
import { matchPRFiles } from './src/featureMatcher.js';
import {
  getGraphToken,
  findItemBySlug,
  createItem,
  patchItem,
  uploadAttachment,
} from './src/sharepointClient.js';
import { listMergedPRs, getPRFiles } from './src/githubClient.js';

const args = parseArgs(process.argv.slice(2));
const env = (k) => {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
  return process.env[k];
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--resume') out.resume = true;
    else if (a === '--feature') out.feature = argv[++i];
  }
  return out;
}

async function main() {
  const repoDir = env('REPO_DIR');
  const owner = env('GH_OWNER');
  const repo = env('GH_REPO');
  const ghToken = env('GITHUB_TOKEN');

  const inventory = loadFeatureInventory('features.yaml');
  const features = args.feature
    ? inventory.filter((f) => f.slug === args.feature)
    : inventory;

  if (features.length === 0) {
    console.error(`No matching features (--feature ${args.feature})`);
    process.exit(1);
  }

  // Step 1: Walk merged PRs once, build map: feature.slug -> [{prNumber,title,author,date}]
  console.log('Walking merged PRs...');
  const prsByFeature = new Map(features.map((f) => [f.slug, []]));
  let prCount = 0;
  for await (const pr of listMergedPRs({ token: ghToken, owner, repo })) {
    prCount += 1;
    if (prCount % 25 === 0) console.log(`  ...${prCount} PRs scanned`);
    let files;
    try {
      files = await getPRFiles({ token: ghToken, owner, repo, prNumber: pr.number });
    } catch (err) {
      console.error(`  PR #${pr.number}: getPRFiles failed: ${err.message}`);
      continue;
    }
    const { matched } = matchPRFiles(files, features);
    for (const f of matched) {
      prsByFeature.get(f.slug).push({
        number: pr.number,
        title: pr.title,
        author: pr.author,
        date: pr.mergedAt.slice(0, 10),
      });
    }
  }
  console.log(`Done: ${prCount} merged PRs processed.`);

  if (args.dryRun) {
    for (const f of features) {
      console.log(`${f.slug}: ${prsByFeature.get(f.slug).length} contributing PRs`);
    }
    return;
  }

  // Step 2: Connect to SharePoint and process features
  const token = await getGraphToken({
    tenantId: env('AZURE_TENANT_ID'),
    clientId: env('AZURE_CONTENT_CLIENT_ID'),
    clientSecret: env('AZURE_CONTENT_CLIENT_SECRET'),
  });
  const siteId = env('LISTS_SITE_ID');
  const listId = env('LISTS_LIST_ID');

  const limit = pLimit(4);
  const errors = [];

  await Promise.all(
    features.map((feature) =>
      limit(async () => {
        try {
          if (args.resume) {
            const existing = await findItemBySlug({ token, siteId, listId, slug: feature.slug });
            if (existing) {
              console.log(`${feature.slug}: SKIP (already exists)`);
              return;
            }
          }

          console.log(`${feature.slug}: processing...`);
          const surfaceFiles = readSurfaceFiles({
            repoDir,
            ref: 'HEAD',
            globs: feature.surfaceGlobs,
          });
          const { summary, mermaid, pngBuffer } = await generateFeatureDiagram({
            feature,
            surfaceFiles,
          });

          const prs = prsByFeature.get(feature.slug) ?? [];
          const contributingPRs = prs
            .map((p) => `#${p.number} — ${p.title} — @${p.author} (${p.date})`)
            .join('\n');
          const authors = Array.from(new Set(prs.map((p) => `@${p.author}`))).join(', ');

          const existing = await findItemBySlug({ token, siteId, listId, slug: feature.slug });
          const fields = {
            Title: feature.displayName,
            Slug: feature.slug,
            Description: summary,
            DiagramSource: mermaid,
            SurfaceFiles: surfaceFiles.map((f) => f.path).join('\n'),
            ContributingPRs: contributingPRs,
            Authors: authors,
            LastUpdated: new Date().toISOString(),
          };

          let itemId;
          if (existing) {
            await patchItem({ token, siteId, listId, itemId: existing.id, fields });
            itemId = existing.id;
          } else {
            const created = await createItem({ token, siteId, listId, fields });
            itemId = created.id;
          }
          await uploadAttachment({
            token,
            siteId,
            listId,
            itemId,
            filename: `${feature.slug}.png`,
            pngBuffer,
          });
          console.log(`${feature.slug}: OK (itemId=${itemId})`);
        } catch (err) {
          console.error(`${feature.slug}: FAILED — ${err.message}`);
          errors.push({ slug: feature.slug, error: err.message });
        }
      })
    )
  );

  if (errors.length > 0) {
    writeFileSync('backfill-errors.json', JSON.stringify(errors, null, 2));
    console.error(`${errors.length} feature(s) failed. See backfill-errors.json.`);
    process.exit(1);
  }
  console.log('Backfill complete.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `p-limit` dep**

```bash
npm install p-limit
```

- [ ] **Step 3: Dry-run against business_brain to validate matching**

```bash
REPO_DIR="c:/code/the everything/business_brain" \
  GH_OWNER=staino83 GH_REPO=business_brain \
  GITHUB_TOKEN=$(gh auth token) \
  node backfill.mjs --dry-run
```

Expected: prints PR count per feature. Review for sanity (xero should have ~10+, gate-engine should have several, etc.).

- [ ] **Step 4: Commit**

```bash
git add backfill.mjs package.json package-lock.json
git commit -m "feat(backfill): one-shot orchestrator for full-history feature catalog"
```

---

## Phase 6: End-to-end smoke test

### Task 6.1: docs/SMOKE_TEST.md

**Files:**
- Create: `pr-teams-notifier/docs/SMOKE_TEST.md`

- [ ] **Step 1: Document the smoke procedure**

```markdown
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
   - [ ] Card has "View row" link
4. Open the Feature Docs Lists tab:
   - [ ] "bookkeeper" row exists, with diagram attachment
   - [ ] ContributingPRs has the new PR
   - [ ] Authors includes the PR author
5. Close the PR.

## Backfill (one-shot)

1. Run dry-run first:
   ```bash
   REPO_DIR="c:/code/the everything/business_brain" \
     GH_OWNER=staino83 GH_REPO=business_brain \
     GITHUB_TOKEN=$(gh auth token) \
     node backfill.mjs --dry-run
   ```
2. Verify PR-per-feature counts look right.
3. Run for one feature first:
   ```bash
   node backfill.mjs --feature xero
   ```
4. Verify in Lists tab.
5. Run all:
   ```bash
   node backfill.mjs
   ```
6. Verify row count == feature count in `features.yaml`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/SMOKE_TEST.md
git commit -m "docs: smoke test procedure for per-PR + backfill flows"
```

---

## Phase 7: Update R27 in business_brain

### Task 7.1: docs/UNIVERSAL_RULES.md edit

**Files:**
- Modify: `business_brain/docs/UNIVERSAL_RULES.md` (R27 section)

- [ ] **Step 1: Update the "How it fires" subsection**

Change "AI-generated entry in the Feature Docs Lists tab" to "AI-generated **upsert into the touched feature's row** in the Feature Docs Lists tab (key = feature slug, defined in `pr-teams-notifier/features.yaml`)".

Add a new bullet under "How to apply":
- "If your PR touches files outside any feature surface, the Teams card will warn — add the files to a glob in `pr-teams-notifier/features.yaml`."

- [ ] **Step 2: Commit on a feature branch**

```bash
cd c:/code/the\ everything/business_brain
git checkout -b docs/r27-upsert-clarification
git add docs/UNIVERSAL_RULES.md
git commit -m "docs(R27): clarify per-feature upsert and uncovered-file warning"
```

---

## Self-review checklist (run after writing the plan)

- [x] Spec coverage: Every section/requirement in the spec maps to a task. Phase 0 = pipeline fix (spec §7); Phase 1 = inventory + matching (spec §3, §4, §5); Phase 2 = diagram generator (spec §5 diagram); Phase 3 = SharePoint (spec §5 upsert); Phase 4 = notify.js refactor (spec §3 Flow 2); Phase 5 = backfill (spec §3 Flow 1); Phase 6 = e2e smoke (spec §6); Phase 7 = R27 doc update (spec §1 + §3 invariants).
- [x] Placeholder scan: No "TBD"/"TODO". Task 4.3's card body is a structural pseudocode-with-instructions to copy from existing notify.js — acceptable since the source is in the same repo.
- [x] Type consistency: `surfaceGlobs` (yaml) → `feature.surfaceGlobs` (modules). `slug` is the upsert key throughout. `pngBuffer` flows from `generateFeatureDiagram` → `uploadAttachment` consistently. ContributingPRs line format matches between `notify.js` and `backfill.mjs` (`#N — title — @author (YYYY-MM-DD)`).
