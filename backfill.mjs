// backfill.mjs
// One-shot: walks features.yaml, generates diagram + upserts row for each.
// Walks merged PRs and adds them to ContributingPRs/Authors based on file matching.
//
// Usage:
//   node backfill.mjs                      # all features
//   node backfill.mjs --feature xero       # one feature
//   node backfill.mjs --resume             # skip features already in Lists
//   node backfill.mjs --dry-run            # log only, no writes

import { writeFileSync } from 'fs';
import pLimit from 'p-limit';
import { loadFeatureInventory } from './src/featureInventory.js';
import { readSurfaceFiles } from './src/surfaceReader.js';
import { generateFeatureDiagram } from './src/diagramGenerator.js';
import { matchPRFiles } from './src/featureMatcher.js';
import {
  getGraphToken,
  findItemBySlug,
  createItem,
  patchItem,
  uploadAttachment,
} from './src/sharepointClient.js';
import { listMergedPRs, getPRFiles } from './src/githubClient.js';

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

const args = parseArgs(process.argv.slice(2));
const env = (k) => {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
  return process.env[k];
};

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
