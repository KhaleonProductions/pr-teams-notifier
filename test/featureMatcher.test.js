import { matchPRFiles } from '../src/featureMatcher.js';

const inv = [
  {
    slug: 'xero',
    surfaceGlobs: [
      'teams_bot/src/cards/xeroOnboardingCard.ts',
      'teams_bot/src/services/bookkeeper/xero*.ts',
    ],
  },
  {
    slug: 'gate-engine',
    surfaceGlobs: ['teams_bot/src/services/gateEngine/**'],
  },
];

describe('matchPRFiles', () => {
  test('exact path match', () => {
    const res = matchPRFiles(['teams_bot/src/cards/xeroOnboardingCard.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
    expect(res.uncovered).toEqual([]);
  });

  test('glob match (xero* prefix)', () => {
    const res = matchPRFiles(['teams_bot/src/services/bookkeeper/xeroApi.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
  });

  test('double-star match', () => {
    const res = matchPRFiles(['teams_bot/src/services/gateEngine/digest.ts'], inv);
    expect(res.matched.map((f) => f.slug)).toEqual(['gate-engine']);
  });

  test('multiple features match (one PR, two features)', () => {
    const res = matchPRFiles(
      [
        'teams_bot/src/cards/xeroOnboardingCard.ts',
        'teams_bot/src/services/gateEngine/digest.ts',
      ],
      inv
    );
    expect(res.matched.map((f) => f.slug).sort()).toEqual(['gate-engine', 'xero']);
    expect(res.uncovered).toEqual([]);
  });

  test('uncovered file', () => {
    const res = matchPRFiles(['README.md'], inv);
    expect(res.matched).toEqual([]);
    expect(res.uncovered).toEqual(['README.md']);
  });

  test('mixed: matched + uncovered', () => {
    const res = matchPRFiles(
      ['teams_bot/src/cards/xeroOnboardingCard.ts', 'README.md'],
      inv
    );
    expect(res.matched.map((f) => f.slug)).toEqual(['xero']);
    expect(res.uncovered).toEqual(['README.md']);
  });

  test('returns each feature at most once even if multiple files match', () => {
    const res = matchPRFiles(
      [
        'teams_bot/src/cards/xeroOnboardingCard.ts',
        'teams_bot/src/services/bookkeeper/xeroApi.ts',
      ],
      inv
    );
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].slug).toBe('xero');
  });

  test('negation glob (!) excludes a path', () => {
    const inv2 = [
      {
        slug: 'bookkeeper',
        surfaceGlobs: [
          'teams_bot/src/services/bookkeeper/**',
          '!teams_bot/src/services/bookkeeper/xero*.ts',
        ],
      },
    ];
    const xero = matchPRFiles(['teams_bot/src/services/bookkeeper/xeroApi.ts'], inv2);
    const other = matchPRFiles(['teams_bot/src/services/bookkeeper/scraper-v2.ts'], inv2);
    expect(xero.matched).toEqual([]);
    expect(xero.uncovered).toEqual(['teams_bot/src/services/bookkeeper/xeroApi.ts']);
    expect(other.matched.map((f) => f.slug)).toEqual(['bookkeeper']);
  });
});
