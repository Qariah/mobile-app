// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): every notification text key is in the
// English and the Arabic `qariah` namespace, short enough for a notice, and
// renders with the params that the engine passes (no `{{…}}` left).
import i18next, {type i18n as I18n} from 'i18next';
import en from '@/i18n/locales/en/qariah.json';
import ar from '@/i18n/locales/ar/qariah.json';
import {NOTIFICATION_TEXT_KEYS} from '../types';
import {
  buildRecitationCandidates,
  continueListeningCandidate,
  kahfFridayCandidate,
} from '../scheduler';
import type {Reciter} from '@/data/reciterData';
import type {NotificationText} from '../types';

/** The notice limits of the sprint brief (titles 40, bodies 110 characters). */
const MAX_TITLE = 40;
const MAX_BODY = 110;

/** The Android channel names (`expoNotifier.ts` `NOTIFICATION_CHANNELS`). */
const CHANNEL_KEYS = [
  'qariah:notifications.channels.followedRecitation',
  'qariah:notifications.channels.newRecitation',
  'qariah:notifications.channels.kahfFriday',
  'qariah:notifications.channels.continueListening',
  'qariah:notifications.channels.whatsNew',
];

/**
 * The notification card (`components/notifications/NotificationSoftPrompt.tsx`).
 * It also shows the switch titles of the Notifications page (above) and, on
 * Android, upstream's `common:actions.ok`.
 */
const SOFT_PROMPT_KEYS = [
  'qariah:notifications.softPrompt.title',
  'qariah:notifications.softPrompt.footer',
  'qariah:notifications.softPrompt.allow',
  'qariah:notifications.softPrompt.choose',
  'qariah:common.notNow',
];

const ARABIC_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const ENGLISH_FORMS = ['one', 'other'];

type Tree = {[key: string]: string | Tree};

/** The values of a key: one value, or each plural form of it. */
function valuesOf(
  tree: Tree,
  key: string,
  forms: readonly string[],
): string[] | null {
  const path = key.replace(/^qariah:/, '').split('.');
  const leaf = path.pop() as string;
  let node: Tree | string | undefined = tree;
  for (const part of path) {
    node = typeof node === 'object' ? node[part] : undefined;
  }
  if (typeof node !== 'object') return null;
  const single = node[leaf];
  if (typeof single === 'string') return [single];
  const plural = forms.map(form => node[`${leaf}_${form}`]);
  return plural.every(value => typeof value === 'string')
    ? (plural as string[])
    : null;
}

const allKeys = [
  ...NOTIFICATION_TEXT_KEYS,
  ...CHANNEL_KEYS,
  ...SOFT_PROMPT_KEYS,
];

describe('the notification text keys', () => {
  it.each(allKeys)('%s is in English and in Arabic', key => {
    expect({
      key,
      en: valuesOf(en as Tree, key, ENGLISH_FORMS) !== null,
    }).toEqual({key, en: true});
    expect({key, ar: valuesOf(ar as Tree, key, ARABIC_FORMS) !== null}).toEqual(
      {key, ar: true},
    );
  });

  it.each(NOTIFICATION_TEXT_KEYS)('%s is short enough for a notice', key => {
    const max = key.endsWith('.title') ? MAX_TITLE : MAX_BODY;
    for (const [language, tree, forms] of [
      ['en', en, ENGLISH_FORMS],
      ['ar', ar, ARABIC_FORMS],
    ] as const) {
      for (const value of valuesOf(tree as Tree, key, forms) ?? []) {
        expect({language, key, value, short: value.length <= max}).toEqual({
          language,
          key,
          value,
          short: true,
        });
      }
    }
  });
});

describe('the rendered notices', () => {
  let instance: I18n;

  beforeAll(async () => {
    instance = i18next.createInstance();
    await instance.init({
      resources: {en: {qariah: en}, ar: {qariah: ar}},
      lng: 'en',
      fallbackLng: false,
      ns: ['qariah'],
      interpolation: {escapeValue: false},
      returnNull: false,
    });
  });

  const reciter = (id: string, name: string, surahs: number[]): Reciter =>
    ({
      id,
      name,
      slug: id,
      rewayat: [
        {
          id: `${id}-w`,
          name: 'Hafs',
          surah_list: surahs,
          surah_metadata: surahs.map((surah, i) => ({
            surah,
            added_at: `2026-10-1${i}`,
            ...(i === 0 ? {is_full: false, range: {from: 1, to: 10}} : {}),
          })),
        },
      ],
    }) as unknown as Reciter;

  /** Each text that the builders make: single, range, summaries, Kahf, continue. */
  function builtTexts(): NotificationText[] {
    const single = reciter('r-a', 'A', [36]);
    const many = reciter('r-b', 'B', [1, 2, 3]);
    const out = [
      ...buildRecitationCandidates({
        newKeys: ['r-a|r-a-w|36|1|10'],
        reciters: [single],
        favoriteReciterIds: ['r-a'],
      }),
      ...buildRecitationCandidates({
        newKeys: ['r-a|r-a-w|36|1|10'],
        reciters: [single],
        favoriteReciterIds: [],
      }),
      ...buildRecitationCandidates({
        newKeys: ['r-b|r-b-w|1|1|10', 'r-b|r-b-w|2||', 'r-b|r-b-w|3||'],
        reciters: [many],
        favoriteReciterIds: ['r-b'],
      }),
      ...buildRecitationCandidates({
        newKeys: ['r-b|r-b-w|1|1|10', 'r-b|r-b-w|2||', 'r-b|r-b-w|3||'],
        reciters: [many],
        favoriteReciterIds: [],
      }),
      kahfFridayCandidate(),
      continueListeningCandidate({surahName: 'Yasin', reciterName: 'A'}),
    ];
    return out.flatMap(c => [c.title, ...(c.body ? [c.body] : [])]);
  }

  it.each(['en', 'ar'])(
    'in %s, every built text renders with no placeholder left',
    async language => {
      await instance.changeLanguage(language);
      const texts = builtTexts();
      // A single notice of each recitation type, 2 summaries, Kahf and
      // continue: 6 notices, each with a title and a body.
      expect(texts).toHaveLength(12);
      for (const text of texts) {
        if (!('key' in text)) throw new Error('a built text is a key');
        // The keys are built at run time; the typed `t()` does not take them.
        const t = instance.t.bind(instance) as unknown as (
          key: string,
          options: Record<string, unknown>,
        ) => string;
        const rendered = t(text.key, {appName: 'Qariah', ...text.params});
        expect({key: text.key, rendered}).toEqual({
          key: text.key,
          rendered: expect.not.stringMatching(/{{|}}|qariah:/),
        });
      }
    },
  );
});
