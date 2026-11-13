// @ai-generated
// Qariah (2026-11-08): shared parts of the Settings › What's New screen tests
// (components/changelog/__tests__/WhatsNewScreen.*.test.tsx). Each suite
// mocks `@/i18n/language` with its own UI language, because the app reads
// the language once, at start.
import changelogData from '@/data/changelog.json';
import type {ChangelogEntry} from '@/types/changelog';
import {
  CHANGELOG_LIST_SECTIONS,
  changelogVersionKey,
  getChangelogTables,
} from '@/i18n/qariahChangelog';

export const latestChangelog = (changelogData as ChangelogEntry[])[0];

/** The keys and the English of the strings that the screen shows. */
export function shownOnScreen(entry: ChangelogEntry): Array<[string, string]> {
  const base = changelogVersionKey(entry.version);
  const out: Array<[string, string]> = [];
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

const arabic = getChangelogTables().ar ?? {};

export const englishShown = shownOnScreen(latestChangelog).map(
  ([, english]) => english,
);
export const arabicShown = shownOnScreen(latestChangelog).map(
  ([key]) => arabic[key] ?? '',
);

/** The theme that the screen and ChangelogContent read. */
export const mockTheme = {
  theme: {
    isDarkMode: false,
    colors: {
      text: '#111111',
      textSecondary: '#666666',
      background: '#ffffff',
    },
    fonts: {regular: 'Manrope-Regular'},
  },
};
