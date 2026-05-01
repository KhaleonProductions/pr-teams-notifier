import { jest } from '@jest/globals';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadFeatureInventory } from '../src/featureInventory.js';

const tmpYaml = (content) => {
  const path = join(tmpdir(), `features-${Date.now()}-${Math.random()}.yaml`);
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
