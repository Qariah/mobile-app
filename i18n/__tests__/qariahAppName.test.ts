// @ai-generated
// Qariah: the app name in each language (README decision 1 of the Arabic
// review pack). English shows `branding.appName`. Arabic shows "قارئة" alone
// in brand places and "تطبيق قارئة" ("the Qariah app") inside a sentence, so
// a sentence never reads "a female reciter".
import branding from '@/config/branding';
import i18n from '@/i18n';
import {getAppDisplayName, withQariahPostProcess} from '../qariahAppName';
import {resources} from '../resources';

const ARABIC_NAME = 'قارئة';
const appName = branding.appName;

type Tree = {[key: string]: string | Tree};

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

describe('getAppDisplayName', () => {
  it('is branding.appName in English', () => {
    expect(getAppDisplayName('en')).toBe(appName);
  });

  it('is قارئة in Arabic', () => {
    expect(getAppDisplayName('ar')).toBe(ARABIC_NAME);
  });

  it('falls back to branding.appName for a language without a name', () => {
    expect(getAppDisplayName('xx')).toBe(appName);
  });
});

describe('the qariahAppName post-processor', () => {
  it('runs before upstream post-processors', () => {
    expect(withQariahPostProcess(false)).toEqual(['qariahAppName']);
    expect(withQariahPostProcess(['localizedDigits'])).toEqual([
      'qariahAppName',
      'localizedDigits',
    ]);
  });

  it('leaves English as it is', () => {
    expect(i18n.t('settings:layout.about', {appName, lng: 'en'})).toBe(
      `About ${appName}`,
    );
    expect(
      i18n.t('content:onboarding.welcome.title', {appName, lng: 'en'}),
    ).toBe(`Welcome to ${appName}`);
  });

  it('puts "تطبيق قارئة" inside an Arabic sentence', () => {
    expect(
      i18n.t('content:onboarding.welcome.title', {appName, lng: 'ar'}),
    ).toBe('مرحبًا بك في تطبيق قارئة');
    expect(i18n.t('settings:layout.about', {appName, lng: 'ar'})).toBe(
      'عن تطبيق قارئة',
    );
    expect(i18n.t('settings:credits.intro', {appName, lng: 'ar'})).toMatch(
      /^ما كان لتطبيق قارئة أن يرى النور/,
    );
    expect(i18n.t('qariah:battery.body', {appName, lng: 'ar'})).toContain(
      'تطبيق قارئة',
    );
  });

  it('keeps "قارئة" alone in an Arabic brand label', () => {
    expect(
      i18n.t('collection:systemPlaylist.curatedBadge', {appName, lng: 'ar'}),
    ).toBe('مختارات قارئة');
  });

  it('leaves no Latin app name in Arabic text that names the app', () => {
    const arabic = i18n.t('settings:index.analytics.description', {
      appName,
      lng: 'ar',
    });
    expect(arabic).not.toContain(appName);
    expect(arabic).toContain('تطبيق قارئة');
  });

  it('acts only when the caller passes the app name', () => {
    // A value that merely contains the Latin word stays as it is.
    expect(
      i18n.t('qariah:browse.translationTitle', {language: appName, lng: 'ar'}),
    ).toContain(appName);
  });
});

describe('Arabic strings that name the app', () => {
  // README decision 1: the brand labels where the name stands alone. Keep in
  // step with APP_NAME_BRAND_PLACES in scripts/i18n-qariah-from-review.mjs.
  const BRAND_PLACES = new Set([
    'collection:systemPlaylist.curatedBadge',
    'content:systemPlaylists.appEssentials.title',
    'settings:credits.footer',
  ]);

  const values = Object.entries(resources.ar).flatMap(([ns, tree]) =>
    Object.entries(flatten(tree as Tree)).map(
      ([key, value]) => [`${ns}:${key}`, value] as const,
    ),
  );

  it('say "تطبيق" before {{appName}} inside a sentence', () => {
    const named = values.filter(([, value]) => value.includes('{{appName}}'));
    expect(named.length).toBeGreaterThan(0);
    for (const [key, value] of named) {
      if (BRAND_PLACES.has(key)) continue;
      const bare = value
        .split(/(?:<brand>)?\{\{appName\}\}/)
        .slice(0, -1)
        .some(before => !before.endsWith('تطبيق '));
      expect({key, value, bare}).toEqual({key, value, bare: false});
    }
  });
});
