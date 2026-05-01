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
