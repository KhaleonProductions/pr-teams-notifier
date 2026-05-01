// notify.js
// Per-feature upsert flow for R27 auto-doc.

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
import {
  postChannelCardViaBotFramework,
  buildCard,
} from './src/botFrameworkClient.js';

const env = (k, def) => process.env[k] ?? def;

// loadPRData — two paths:
//
// 1. PR_JSON (set by the local hook / gh CLI caller):
//    Contains the full PR object from `gh pr view --json`. Files come from
//    pr.files[].path so no extra API call is needed.
//
// 2. Env-var path (set by the reusable GH Actions workflow):
//    PR_REPO, PR_NUMBER, PR_TITLE, PR_URL are already set by the workflow.
//    PR_AUTHOR and PR_HEAD_SHA are NOT yet set by the reusable workflow —
//    they need to be added to the workflow env block:
//       PR_AUTHOR:   ${{ github.event.pull_request.user.login }}
//       PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
//    REPO_DIR must also be set:
//       REPO_DIR: ${{ github.workspace }}
//    Until those are added, `author` defaults to 'unknown' and surface reading
//    may fall back to filesystem reads (surfaceReader handles missing ref gracefully).
//    GITHUB_TOKEN is already exported by the workflow env block; used here to
//    fetch the PR file list via the GH REST API.

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

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  // --- Env-var preflight (before any HTTP work) ---
  requireEnv([
    'LISTS_SITE_ID',
    'LISTS_LIST_ID',
    'AZURE_TENANT_ID',
    'AZURE_CONTENT_CLIENT_ID',
    'AZURE_CONTENT_CLIENT_SECRET',
    'REPO_DIR',
  ]);

  if (env('SKIP_TEAMS') !== '1') {
    requireEnv([
      'BOT_HOME_AZURE_TENANT_ID',
      'TEAMS_APP_ID',
      'TEAMS_APP_PASSWORD',
      'TARGET_TEAM_ID',
      'TARGET_CHANNEL_ID',
    ]);
  }

  if (!process.env.PR_JSON) {
    requireEnv(['PR_REPO', 'PR_NUMBER', 'PR_TITLE', 'PR_URL', 'PR_AUTHOR', 'PR_HEAD_SHA', 'GITHUB_TOKEN']);
  }

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

  // SURFACE_REF defaults to 'HEAD' — the right default for CI where
  // actions/checkout@v4 has already checked out the correct commit. Set
  // SURFACE_REF explicitly if running a local backfill against a specific SHA.
  const surfaceRef = env('SURFACE_REF', 'HEAD');

  const upsertResults = [];

  for (const feature of matched) {
    console.log(`\n--- ${feature.slug} ---`);
    try {
      const surfaceFiles = readSurfaceFiles({
        repoDir,
        ref: surfaceRef,
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

      const dateStr = (pr.mergedAt ?? new Date().toISOString()).slice(0, 10);
      const prLine = `#${pr.number} — ${pr.title} — @${pr.author} (${dateStr})`;

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
    }
  }

  // Post a summary card to Teams (one card per PR, listing all touched features).
  if (env('SKIP_TEAMS') !== '1') {
    const card = buildCard({ pr, upsertResults, uncovered, listsDispformBase: env('LISTS_DISPFORM_BASE_URL') });
    await postChannelCardViaBotFramework({
      tenantId: env('BOT_HOME_AZURE_TENANT_ID'),
      appId: env('TEAMS_APP_ID'),
      appPassword: env('TEAMS_APP_PASSWORD'),
      teamId: env('TARGET_TEAM_ID'),
      channelId: env('TARGET_CHANNEL_ID'),
      targetTenantId: env('AZURE_TENANT_ID'),
      summary: `PR #${pr.number} — ${pr.title}`,
      card,
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
