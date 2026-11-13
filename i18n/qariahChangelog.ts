// @ai-generated
// Qariah: the What's New changelog in the UI language (2026-11-08, owner
// request).
//
// data/changelog.json is English data, as upstream keeps it. Section Q of the
// review pack (planning/pass-c/arabic-review/ui-strings.csv) gives each string
// that the screen shows an Arabic text, and
// scripts/i18n-qariah-from-review.mjs writes it to the `qariah` namespace:
//   changelog.<version key>.title
//   changelog.<version key>.highlights.<index>.title
//   changelog.<version key>.highlights.<index>.description
//   changelog.<version key>.<features | improvements | fixes>.<index>
// The version key is `changelogVersionKey` ("3.2.5" → "v3_2_5"). `technical`
// is not on the screen, so it has no keys and stays in English.
//
// The English file has the same keys with the English of data/changelog.json.
// A string shows in the UI language only when that English copy is still the
// text of data/changelog.json. A new or changed English string shows in
// English until the pack has its row, so an old translation never shows for
// a new text. i18n/__tests__/qariahChangelog.test.ts fails on such a string.
//
// English (the source language) gets the entry object as it is.
import type {
  ChangelogEntry,
  ChangelogFullDetails,
  ChangelogHighlight,
} from '@/types/changelog';
import {currentLanguage} from './language';
import {SOURCE_LANGUAGE, isAppLanguage, type AppLanguage} from './languages';
import {resources} from './resources';
import type {LocaleTree} from './qariahOverrides';

/** Flat changelog strings of one language: "v3_2_5.fixes.0" → text. */
export type ChangelogStrings = Readonly<Record<string, string>>;
export type ChangelogTables = Readonly<
  Partial<Record<AppLanguage, ChangelogStrings>>
>;

type ListSection = Exclude<keyof ChangelogFullDetails, 'technical'>;

/** The sections of `fullChangelog` that the What's New screen shows. */
export const CHANGELOG_LIST_SECTIONS: readonly ListSection[] = [
  'features',
  'improvements',
  'fixes',
];

/** "3.2.5" → "v3_2_5". An i18n key cannot hold the dots of a version. */
export function changelogVersionKey(version: string): string {
  return `v${version.replace(/[^0-9A-Za-z]/g, '_')}`;
}

function flatten(tree: LocaleTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

let defaultTables: ChangelogTables | null = null;

/** The `qariah:changelog.*` strings of each language, read once. */
export function getChangelogTables(): ChangelogTables {
  if (!defaultTables) {
    const tables: Partial<Record<AppLanguage, ChangelogStrings>> = {};
    for (const [language, namespaces] of Object.entries(resources)) {
      if (!isAppLanguage(language)) continue;
      const tree = (namespaces.qariah as unknown as LocaleTree).changelog;
      tables[language] = typeof tree === 'object' ? flatten(tree) : {};
    }
    defaultTables = tables;
  }
  return defaultTables;
}

/**
 * The changelog entry in `language`: each string that has a current
 * translation, else the English of data/changelog.json. Version, date, icons
 * and `technical` do not change.
 */
export function localizeChangelogEntry(
  entry: ChangelogEntry,
  language: string = currentLanguage,
  tables: ChangelogTables = getChangelogTables(),
): ChangelogEntry {
  if (language === SOURCE_LANGUAGE || !isAppLanguage(language)) {
    return entry;
  }
  const english = tables[SOURCE_LANGUAGE];
  const local = tables[language];
  if (!english || !local) {
    return entry;
  }
  const base = changelogVersionKey(entry.version);
  const text = (field: string, source: string): string => {
    const key = `${base}.${field}`;
    return english[key] === source ? local[key] || source : source;
  };

  const highlights: ChangelogHighlight[] = entry.highlights.map(
    (highlight, index) => ({
      ...highlight,
      title: text(`highlights.${index}.title`, highlight.title),
      description: text(
        `highlights.${index}.description`,
        highlight.description,
      ),
    }),
  );

  const localized: ChangelogEntry = {
    ...entry,
    title: text('title', entry.title),
    highlights,
  };
  if (entry.fullChangelog) {
    const details: ChangelogFullDetails = {...entry.fullChangelog};
    for (const section of CHANGELOG_LIST_SECTIONS) {
      const items = entry.fullChangelog[section];
      if (items) {
        details[section] = items.map((item, index) =>
          text(`${section}.${index}`, item),
        );
      }
    }
    localized.fullChangelog = details;
  }
  return localized;
}
