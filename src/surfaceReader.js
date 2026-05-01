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
