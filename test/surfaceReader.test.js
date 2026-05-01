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
  execSync('git add .', { cwd: dir });
  execSync('git commit -q -m init', { cwd: dir });
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
