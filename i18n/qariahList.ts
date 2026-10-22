// @ai-generated
// Qariah: joins a list of phrases in the UI language (Sprint 47, Pass C).
//
// Hermes has no `Intl.ListFormat`, so the words come from the qariah
// namespace (review pack rows 300-302):
//   formatList       English "a", "a and b", "a, b, and c"
//                    Arabic  "أ", "أ وب", "أ، ب، وج"
//   formatCommaList  English "a, b, c"   Arabic "أ، ب، ج"
// The text is translated when a function runs, never at module load.
import i18n from './index';

/** Joins `items` with the language's comma only. */
export function formatCommaList(items: readonly string[]): string {
  if (items.length === 0) return '';
  return items.reduce((first, second) =>
    i18n.t('qariah:list.more', {first, second}),
  );
}

/** Joins `items` with the language's comma and "and" before the last item. */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) {
    return i18n.t('qariah:list.two', {first: items[0], second: items[1]});
  }
  const last = items[items.length - 1];
  return i18n.t('qariah:list.last', {
    items: formatCommaList(items.slice(0, -1)),
    last,
  });
}
