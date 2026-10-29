// @ai-generated
// Qariah (#535, owner decision 2026-10-25): the English UI says "Qariah" /
// "Qariahs" where upstream says "Reciter" / "Reciters". Upstream keys get the
// wording through i18n/overrides/en.json, Qariah keys through the review pack
// (the generator writes i18n/locales/en/qariah.json). This scan fails when an
// English string that the app shows still says "reciter", so a new upstream
// key from a sync gets its override, or an entry here with its reason.
import {resources, namespaces} from '../resources';
import type {LocaleTree} from '../qariahOverrides';

/** English keys that keep "reciter" on purpose, and why. */
const KEEPS_RECITER: Record<string, string> = {
  'settings:credits.items.mp3quran':
    "the MP3Quran credit names MP3Quran's own collection, mostly men (review pack row 254)",
  'sheets:organize.searchReciters':
    "a user's own upload: the reciter can be anyone (review pack row 255)",
  'sheets:organize.customReciter':
    "a user's own upload: the reciter can be anyone (review pack row 255)",
  'content:onboarding.uploads.description':
    "a user's own uploads: the reciter can be anyone (as review pack row 255)",
  'sheets:rewayatInfo.explanation':
    "the famous reciters of the qira'at are the imams, men of the early centuries",
};

const RECITER_WORD = /\b(reciters?|qaris?)\b/i;
// i18n placeholders such as {{reciter}} name a value, not a word on screen.
const PLACEHOLDER = /{{[^}]*}}/g;

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

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Every English string the app has, after the Qariah overlay. */
const english: Record<string, string> = {};
for (const ns of namespaces) {
  const strings = flatten(resources.en[ns as 'qariah'] as LocaleTree);
  for (const [key, value] of Object.entries(strings)) {
    english[`${ns}:${key}`] = value;
  }
}

function saysReciter(value: string): boolean {
  return RECITER_WORD.test(value.replace(PLACEHOLDER, ''));
}

describe('the English UI says "Qariah(s)" (#535)', () => {
  it('has no English string that says "reciter", apart from the kept keys', () => {
    const found = Object.entries(english)
      .filter(([, value]) => saysReciter(value))
      .map(([key]) => key.replace(PLURAL_SUFFIX, ''))
      .filter(key => !(key in KEEPS_RECITER));
    expect([...new Set(found)].sort()).toEqual([]);
  });

  it('keeps "reciter" only in keys that still say it', () => {
    for (const key of Object.keys(KEEPS_RECITER)) {
      expect({key, saysReciter: saysReciter(english[key] ?? '')}).toEqual({
        key,
        saysReciter: true,
      });
    }
  });

  it.each([
    ['common:terms.reciters', 'Qariahs'],
    ['home:reciterBrowse.title', 'Browse Qariahs'],
    ['settings:index.items.defaultReciter.title', 'Default Qariah'],
    ['qariah:listenTop.reciters', 'Qariahs'],
    ['qariah:homeRows.honored', 'Honored Qariahs'],
  ])('%s says "%s"', (key, expected) => {
    expect(english[key]).toBe(expected);
  });

  it('leaves the placeholder names alone', () => {
    expect(english['home:randomHero.playing']).toBe(
      'Playing {{surah}} by {{reciter}}',
    );
  });
});
