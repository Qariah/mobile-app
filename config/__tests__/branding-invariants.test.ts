/**
 * Branding invariants — Bucket A standing regression test.
 *
 * config/branding.js is CJS at runtime; its function-valued fields lazy-`require()` RN code
 * (CLAUDE.md Sprint 24 rule), so a top-level require is safe in the jest/node env. If
 * branding.js ever gains a top-level RN import, add a mock for it here. Runs as part of
 * `npm run test:ci` (Tier 1+). Each assertion maps to a real shipped bug.
 */
const branding: any = require('../branding.js');

describe('branding invariants (config/branding.js)', () => {
  it('app identity is the Qariah brand, not the inherited upstream name', () => {
    expect(branding.appName).toBe('Qariah');
  });

  it("App Store id is Qariah's own listing, not the inherited upstream one (S32: 'Write a Review' had deep-linked to the wrong listing)", () => {
    expect(branding.appStoreId).toBe('1594917787');
  });

  it('homeRowConfig is a non-empty array with no duplicate rows (S26: a duplicate object key shadowed the curated lineup at runtime)', () => {
    expect(Array.isArray(branding.homeRowConfig)).toBe(true);
    expect(branding.homeRowConfig.length).toBeGreaterThan(0);
    const serialized = branding.homeRowConfig.map((row: unknown) =>
      JSON.stringify(row),
    );
    expect(serialized.length).toBe(new Set(serialized).size);
  });
});
