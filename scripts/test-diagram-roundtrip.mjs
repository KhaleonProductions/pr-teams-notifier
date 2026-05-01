// Usage:
//   node scripts/test-diagram-roundtrip.mjs --feature xero --repo "c:/code/the everything/business_brain" --out tmp/xero.png
//
// Requires CLAUDE_OAUTH_CREDS already provisioned at ~/.claude/.credentials.json
// (the Claude Code SDK reads from there; no API key needed).

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
