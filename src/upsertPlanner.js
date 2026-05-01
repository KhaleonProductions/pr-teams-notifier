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
