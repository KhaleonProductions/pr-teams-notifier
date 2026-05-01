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
