import { minimatch } from 'minimatch';

function fileMatchesGlobs(file, globs) {
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
  const matchedFeatures = new Map();
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
