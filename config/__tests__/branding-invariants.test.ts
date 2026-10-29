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

  it('homeRowConfig shows "Newly Added" as recitations (Sprint 48): newly-added-recitations is on', () => {
    const recitations = branding.homeRowConfig.find(
      (row: {id: string}) => row.id === 'newly-added-recitations',
    );
    expect(recitations).toBeDefined();
    expect(recitations.enabled).toBe(true);
  });

  it('homeRowConfig shows "Newly Added Recitations" second, right after Continue Listening (owner, 2026-10-20)', () => {
    const visible = branding.homeRowConfig
      .filter((row: {enabled: boolean}) => row.enabled)
      .map((row: {id: string}) => row.id);
    expect(visible.slice(0, 2)).toEqual([
      'continue-listening',
      'newly-added-recitations',
    ]);
  });

  it('the tablet sidebar shows the Qariah mark, not the inherited starburst (TECH_DEBT #355: the 3.2.2 iPad screenshots)', () => {
    const {existsSync} = require('node:fs');
    const {join} = require('node:path');
    const descriptor = Object.getOwnPropertyDescriptor(branding, 'sidebarLogo');
    // A getter: a top-level PNG require() would crash the app.config.js eval.
    expect(typeof descriptor?.get).toBe('function');
    expect(branding.sidebarLogo.light).toBeTruthy();
    expect(branding.sidebarLogo.dark).toBeTruthy();
    for (const file of ['sidebar-logo.png', 'sidebar-logo-dark.png']) {
      expect(
        existsSync(join(__dirname, '..', '..', 'assets', 'branding', file)),
      ).toBe(true);
    }
  });

  it('the HomeRowId type has the newly-added-recitations id (config/branding.d.ts)', () => {
    // RecitersView's `rowNodes` is a Record<HomeRowId, …>, so tsc then
    // requires a node for the id; this test keeps the id in the type.
    const {readFileSync} = require('node:fs');
    const {join} = require('node:path');
    const dts: string = readFileSync(
      join(__dirname, '..', 'branding.d.ts'),
      'utf8',
    );
    // The union: `export type HomeRowId =` up to the first `;` that ends a
    // line (the comments inside the union have `;` in them too).
    const match = /export type HomeRowId =([\s\S]*?);\s*$/m.exec(dts);
    expect(match).not.toBeNull();
    const union = match?.[1] ?? '';
    expect(union).toContain("| 'newly-added-recitations'");
  });
});
