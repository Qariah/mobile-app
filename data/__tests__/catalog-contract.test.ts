/**
 * Catalog data contract — Bucket A standing regression test.
 *
 * Guards the silent data-corruption class that the boot-gate and `tsc` cannot see:
 * the app launches fine with a corrupt catalog, then renders empty slugs / dead audio
 * URLs / wrong ayah ranges. Each assertion maps to a real bug that shipped — see the
 * CLAUDE.md sprint log. Runs automatically as part of `npm run test:ci` (Tier 1+).
 */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {itWithReviewPack} from '@/test-utils/reviewPack';

const catalog: any[] = require('../../assets/data/catalog.json');
const CATALOG_PATH = resolve(__dirname, '../../assets/data/catalog.json');
const NAMES_SCRIPT = resolve(
  __dirname,
  '../../scripts/catalog-arabic-names.mjs',
);

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

  itWithReviewPack(
    'has the Arabic of the review pack (catalog-arabic-names.mjs --check)',
    () => {
      // Throws (and so fails) when a reviewed CSV row is not in the catalog.
      expect(() =>
        execFileSync(
          process.execPath,
          [NAMES_SCRIPT, `--in=${CATALOG_PATH}`, '--check'],
          {stdio: 'pipe'},
        ),
      ).not.toThrow();
    },
  );

  // Sprint 47 (Pass C): the Arabic UI shows `name_arabic` for every reciter
  // and `bio_ar` instead of `bio_en`. Both come from the review pack through
  // scripts/catalog-arabic-names.mjs; a reciter added without them shows
  // English in the Arabic app.
  const ARABIC_LETTER = /\p{Script=Arabic}/u;

  it('every reciter has a name_arabic in Arabic script (S47 Pass C)', () => {
    const offenders = catalog
      .filter(
        r =>
          typeof r.name_arabic !== 'string' ||
          r.name_arabic.trim() === '' ||
          !ARABIC_LETTER.test(r.name_arabic),
      )
      .map(r => `${r.slug}: ${JSON.stringify(r.name_arabic)}`);
    expect(offenders).toEqual([]);
  });

  it('every reciter with a bio_en has a bio_ar in Arabic script (S47 Pass C)', () => {
    const offenders = catalog
      .filter(r => typeof r.bio_en === 'string' && r.bio_en.trim() !== '')
      .filter(
        r =>
          typeof r.bio_ar !== 'string' ||
          r.bio_ar.trim() === '' ||
          !ARABIC_LETTER.test(r.bio_ar),
      )
      .map(r => `${r.slug}: ${JSON.stringify(r.bio_ar)}`);
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

  // Sprint 50 (TECH_DEBT #70): `audio_path: 'suffixed'` sends the app to
  // `{server}/{surah}-{from}-{to}.mp3` (utils/recitationAudioUrl.ts). That URL
  // needs a partial row with an integer range. A row that breaks this rule
  // plays the legacy path, which can be silent.
  function audioPathProblems(reciters: any[]): string[] {
    const offenders: string[] = [];
    for (const r of reciters) {
      for (const rw of r.rewayat ?? []) {
        for (const m of Array.isArray(rw.surah_metadata)
          ? rw.surah_metadata
          : []) {
          if (!m || m.audio_path === undefined) continue;
          const where = `${r.slug} / ${rw.name} / surah ${m.surah}`;
          const range = m.range;
          if (m.audio_path !== 'suffixed') {
            offenders.push(
              `${where}: audio_path ${JSON.stringify(m.audio_path)}`,
            );
          } else if (m.is_full !== false) {
            offenders.push(`${where}: audio_path on a complete surah`);
          } else if (
            !range ||
            !Number.isInteger(range.from) ||
            !Number.isInteger(range.to) ||
            range.from < 1 ||
            range.to < range.from
          ) {
            offenders.push(`${where}: range ${JSON.stringify(range)}`);
          }
        }
      }
    }
    return offenders;
  }

  it("audio_path, when present, is 'suffixed' on a partial row with an integer range (S50, TECH_DEBT #70)", () => {
    expect(audioPathProblems(catalog)).toEqual([]);
  });

  it('the audio_path check finds each bad row (S50, TECH_DEBT #70)', () => {
    const rewaya = (surah_metadata: any[]) => ({
      slug: 'x',
      rewayat: [{name: 'Hafs', surah_metadata}],
    });
    expect(
      audioPathProblems([
        rewaya([
          {
            surah: 1,
            is_full: false,
            range: {from: 1, to: 7},
            audio_path: 'suffixed',
          },
          {surah: 2, is_full: false, range: {from: 1, to: 5}},
          {
            surah: 3,
            is_full: false,
            range: {from: 1, to: 5},
            audio_path: 'other',
          },
          {surah: 4, is_full: true, audio_path: 'suffixed'},
          {surah: 5, is_full: false, audio_path: 'suffixed'},
          {
            surah: 6,
            is_full: false,
            range: {from: 9, to: 2},
            audio_path: 'suffixed',
          },
          {
            surah: 7,
            is_full: false,
            range: {from: '1', to: 5},
            audio_path: 'suffixed',
          },
        ]),
      ]),
    ).toEqual([
      'x / Hafs / surah 3: audio_path "other"',
      'x / Hafs / surah 4: audio_path on a complete surah',
      'x / Hafs / surah 5: range undefined',
      'x / Hafs / surah 6: range {"from":9,"to":2}',
      'x / Hafs / surah 7: range {"from":"1","to":5}',
    ]);
  });

  it('a complete surah row has no ayah range (S48)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        for (const m of Array.isArray(rw.surah_metadata)
          ? rw.surah_metadata
          : []) {
          if (m && m.is_full === true && m.range !== undefined) {
            offenders.push(
              `${r.slug} / ${rw.name} / surah ${m.surah}: ${JSON.stringify(m.range)}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Sprint 48: `added_at` is the UTC date (YYYY-MM-DD) when a recitation first
  // appeared in the catalog. The field is optional for now, so this test
  // checks it only when it is present. A later task makes it required.
  // Sprint 48 (Task 7): catalog v93 dates every listed recitation, so the
  // bundled copy must too. The first row of each listed surah carries the date
  // (the ops console and `scripts/catalog-added-at.mjs` write it there).
  it('every listed surah has a first surah_metadata row with added_at (S48)', () => {
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        const firstRow = new Map<number, any>();
        for (const m of Array.isArray(rw.surah_metadata)
          ? rw.surah_metadata
          : []) {
          if (m && !firstRow.has(m.surah)) firstRow.set(m.surah, m);
        }
        for (const s of rw.surah_list ?? []) {
          if (s == null) continue;
          if (typeof firstRow.get(s)?.added_at !== 'string') {
            offenders.push(`${r.slug} / ${rw.name} / surah ${s}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('added_at, when present on a surah_metadata row, is a real past or current UTC date (S48)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const offenders: string[] = [];
    for (const r of catalog) {
      for (const rw of r.rewayat ?? []) {
        for (const m of Array.isArray(rw.surah_metadata)
          ? rw.surah_metadata
          : []) {
          if (!m || m.added_at === undefined) continue;
          const value = m.added_at;
          const where = `${r.slug} / ${rw.name} / surah ${m.surah}: ${JSON.stringify(value)}`;
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            offenders.push(`${where} (not YYYY-MM-DD)`);
            continue;
          }
          const parsed = new Date(`${value}T00:00:00Z`);
          if (
            Number.isNaN(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== value
          ) {
            offenders.push(`${where} (not a calendar date)`);
            continue;
          }
          if (value > today) offenders.push(`${where} (later than ${today})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
