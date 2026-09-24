/**
 * Catalog data contract — Bucket A standing regression test.
 *
 * Guards the silent data-corruption class that the boot-gate and `tsc` cannot see:
 * the app launches fine with a corrupt catalog, then renders empty slugs / dead audio
 * URLs / wrong ayah ranges. Each assertion maps to a real bug that shipped — see the
 * CLAUDE.md sprint log. Runs automatically as part of `npm run test:ci` (Tier 1+).
 */
const catalog: any[] = require('../../assets/data/catalog.json');

describe('catalog data contract (assets/data/catalog.json)', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('every reciter has id, name, and a non-empty slug (S17: 63/67 slugs were empty → v1-restore broke)', () => {
    const bad = catalog
      .filter(
        r =>
          !r.id ||
          !r.name ||
          typeof r.slug !== 'string' ||
          r.slug.trim() === '',
      )
      .map(r => r.name ?? r.id ?? '(unknown)');
    expect(bad).toEqual([]);
  });

  it('slugs are unique (v1-restore + deep links resolve reciters by slug)', () => {
    const slugs = catalog.map(r => String(r.slug));
    const dupes = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
    expect(dupes).toEqual([]);
  });

  it('every rewaya server is an https origin, never wasabi/http (S15: wasabi 403 silently broke audio)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        const server = String(rw.server ?? '');
        if (!/^https:\/\//.test(server) || /wasabi/i.test(server)) {
          offenders.push(`${r.slug} / ${rw.name}: ${server || '(empty)'}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('image_url, when set, is https and not on wasabi (S15: a wasabi photo URL silently broke images)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      const url = r.image_url;
      if (typeof url === 'string' && url.trim() !== '') {
        if (!/^https:\/\//.test(url) || /wasabi/i.test(url)) {
          offenders.push(`${r.slug}: ${url}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('surah_list.length === surah_total when both are present (S20: badge read stale surah count)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        const len: number | null = Array.isArray(rw.surah_list)
          ? rw.surah_list.length
          : null;
        const total: number | null =
          typeof rw.surah_total === 'number' ? rw.surah_total : null;
        if (len !== null && total !== null && len !== total) {
          offenders.push(`${r.slug} / ${rw.name}: list=${len} total=${total}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('partial recitations carry a valid ayah range (from <= to)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        const meta = Array.isArray(rw.surah_metadata)
          ? rw.surah_metadata
          : null;
        if (!meta) continue;
        for (const m of meta) {
          if (m && m.is_full === false) {
            const range = m.range;
            const ok =
              range &&
              typeof range.from === 'number' &&
              typeof range.to === 'number' &&
              range.from <= range.to;
            if (!ok)
              offenders.push(
                `${r.slug} / ${rw.name} / surah ${m.surah}: ${JSON.stringify(range)}`,
              );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
