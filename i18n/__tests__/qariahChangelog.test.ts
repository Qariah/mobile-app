// @ai-generated
// Qariah (2026-11-08): the What's New changelog in the UI language
// (i18n/qariahChangelog.ts). The Arabic comes from review pack section Q
// (planning/pass-c/arabic-review/ui-strings.csv) through the `qariah`
// namespace; i18n/__tests__/qariah.test.ts checks that the JSON matches the
// pack.
import changelogData from '@/data/changelog.json';
import type {ChangelogEntry} from '@/types/changelog';
import {resources} from '../resources';
import {
  CHANGELOG_LIST_SECTIONS,
  changelogVersionKey,
  getChangelogTables,
  localizeChangelogEntry,
  type ChangelogTables,
} from '../qariahChangelog';

const changelog: ChangelogEntry[] = changelogData;
const ARABIC_LETTER = /\p{Script=Arabic}/u;

/** Every string that the What's New screen can show, with its key. */
function visibleStrings(entry: ChangelogEntry): Array<[string, string]> {
  const base = changelogVersionKey(entry.version);
  const out: Array<[string, string]> = [[`${base}.title`, entry.title]];
  entry.highlights.forEach((highlight, index) => {
    out.push([`${base}.highlights.${index}.title`, highlight.title]);
    out.push([
      `${base}.highlights.${index}.description`,
      highlight.description,
    ]);
  });
  for (const section of CHANGELOG_LIST_SECTIONS) {
    (entry.fullChangelog?.[section] ?? []).forEach((item, index) => {
      out.push([`${base}.${section}.${index}`, item]);
    });
  }
  return out;
}

/** The same strings, read back from a (localized) entry. */
function shownStrings(entry: ChangelogEntry): string[] {
  return [
    entry.title,
    ...entry.highlights.flatMap(h => [h.title, h.description]),
    ...CHANGELOG_LIST_SECTIONS.flatMap(s => entry.fullChangelog?.[s] ?? []),
  ];
}

const tables = getChangelogTables();
const en = tables.en ?? {};
const ar = tables.ar ?? {};

describe('changelogVersionKey', () => {
  it('turns the dots of a version into underscores', () => {
    expect(changelogVersionKey('3.2.5')).toBe('v3_2_5');
    expect(changelogVersionKey('2.2')).toBe('v2_2');
  });
});

describe('the Arabic changelog strings (review pack section Q)', () => {
  it('read every entry of data/changelog.json (7 on 2026-11-08)', () => {
    expect(changelog.length).toBeGreaterThanOrEqual(7);
    expect(changelog.map(entry => entry.version)).toEqual(
      expect.arrayContaining(['3.2.5', '3.2.3', '3.1.3', '2.2', '2.1', '2.0']),
    );
  });

  it('give every string that the screen shows an Arabic text', () => {
    for (const entry of changelog) {
      for (const [key, english] of visibleStrings(entry)) {
        const arabic = ar[key] ?? '';
        expect({
          key,
          englishCopy: en[key],
          arabic: ARABIC_LETTER.test(arabic) && arabic !== english,
        }).toEqual({key, englishCopy: english, arabic: true});
      }
    }
  });

  it('have no key for a string that the changelog does not have', () => {
    const wanted = changelog
      .flatMap(visibleStrings)
      .map(([key]) => key)
      .sort();
    expect(Object.keys(en).sort()).toEqual(wanted);
    expect(Object.keys(ar).sort()).toEqual(wanted);
  });

  it('have no key for `technical`, which the screen does not show', () => {
    expect(Object.keys(en).filter(key => key.includes('.technical'))).toEqual(
      [],
    );
  });
});

describe('localizeChangelogEntry in Arabic', () => {
  it('gives the Arabic text of every string', () => {
    for (const entry of changelog) {
      const localized = localizeChangelogEntry(entry, 'ar');
      expect(shownStrings(localized)).toEqual(
        visibleStrings(entry).map(([key]) => ar[key]),
      );
    }
  });

  it('shows the same Arabic as the 3.2.5 update page for the same English', () => {
    const latest = changelog.find(e => e.version === '3.2.5');
    if (!latest) throw new Error('data/changelog.json has no 3.2.5 entry');
    const localized = localizeChangelogEntry(latest, 'ar');
    const page = resources.ar.qariah.onboarding.release_3_2_5;
    expect(localized.highlights[0].title).toBe(page.ipadTitle);
    expect(localized.highlights[0].description).toBe(page.ipadBody);
    expect(localized.highlights[1].title).toBe(page.fixesTitle);
  });

  it('keeps the version, the date, the icons and `technical`', () => {
    for (const entry of changelog) {
      const localized = localizeChangelogEntry(entry, 'ar');
      expect(localized.version).toBe(entry.version);
      expect(localized.releaseDate).toBe(entry.releaseDate);
      expect(localized.highlights.map(h => h.icon)).toEqual(
        entry.highlights.map(h => h.icon),
      );
      expect(localized.fullChangelog?.technical).toEqual(
        entry.fullChangelog?.technical,
      );
    }
  });

  it('does not change the entry that it reads', () => {
    const [latest] = changelog;
    const before = JSON.stringify(latest);
    localizeChangelogEntry(latest, 'ar');
    expect(JSON.stringify(latest)).toBe(before);
  });

  it('keeps an entry with no fullChangelog without one', () => {
    const entry = changelog.find(e => e.version === '2.1');
    expect(entry?.fullChangelog).toBeUndefined();
    const localized = localizeChangelogEntry(entry as ChangelogEntry, 'ar');
    expect(localized.fullChangelog).toBeUndefined();
    expect(localized.highlights[0].title).toBe(ar['v2_1.highlights.0.title']);
  });
});

describe('localizeChangelogEntry falls back to English', () => {
  const [latest] = changelog;
  const base = changelogVersionKey(latest.version);

  it('for a string that has no Arabic', () => {
    const missing = `${base}.fixes.0`;
    const rest: Record<string, string> = {...ar};
    delete rest[missing];
    const partial: ChangelogTables = {en, ar: rest};
    const localized = localizeChangelogEntry(latest, 'ar', partial);
    expect(localized.fullChangelog?.fixes?.[0]).toBe(
      latest.fullChangelog?.fixes?.[0],
    );
    expect(localized.fullChangelog?.fixes?.[1]).toBe(ar[`${base}.fixes.1`]);
    expect(localized.title).toBe(ar[`${base}.title`]);
  });

  it('for an empty Arabic string', () => {
    const empty: ChangelogTables = {en, ar: {...ar, [`${base}.title`]: ''}};
    expect(localizeChangelogEntry(latest, 'ar', empty).title).toBe(
      latest.title,
    );
  });

  it('for an English text that changed after the translation', () => {
    const changed: ChangelogEntry = {
      ...latest,
      highlights: latest.highlights.map((highlight, index) =>
        index === 0 ? {...highlight, title: 'A new title'} : highlight,
      ),
    };
    const localized = localizeChangelogEntry(changed, 'ar');
    expect(localized.highlights[0].title).toBe('A new title');
    expect(localized.highlights[0].description).toBe(
      ar[`${base}.highlights.0.description`],
    );
  });

  it('for a new line that the pack does not have yet', () => {
    const added: ChangelogEntry = {
      ...latest,
      fullChangelog: {
        ...latest.fullChangelog,
        fixes: [...(latest.fullChangelog?.fixes ?? []), 'A new fix'],
      },
    };
    const fixes = localizeChangelogEntry(added, 'ar').fullChangelog?.fixes;
    expect(fixes?.[fixes.length - 1]).toBe('A new fix');
    expect(fixes?.[0]).toBe(ar[`${base}.fixes.0`]);
  });

  it('for a version that the pack does not have', () => {
    const future: ChangelogEntry = {...latest, version: '9.9.9'};
    const localized = localizeChangelogEntry(future, 'ar');
    expect(shownStrings(localized)).toEqual(shownStrings(latest));
  });

  it('for a language with no changelog strings', () => {
    expect(localizeChangelogEntry(latest, 'ar', {en})).toBe(latest);
  });
});

describe('localizeChangelogEntry in English', () => {
  it('returns each entry as it is', () => {
    for (const entry of changelog) {
      expect(localizeChangelogEntry(entry, 'en')).toBe(entry);
    }
  });

  it('returns the entry as it is for a language that the app does not have', () => {
    const [latest] = changelog;
    expect(localizeChangelogEntry(latest, 'fr')).toBe(latest);
  });
});
