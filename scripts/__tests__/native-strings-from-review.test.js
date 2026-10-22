// @ai-generated
//
// Sprint 47 Task 7: Qariah's native Arabic strings. The generator
// (scripts/native-strings-from-review.mjs) writes them from the review pack.
// At prebuild, Expo copies i18n/native/ar.json (the home-screen name) and
// withQariahNativeStrings.js copies i18n/native/widget-strings.json (the
// Android widget-picker text) into the native projects.

const {execFileSync} = require('child_process');
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('fs');
const os = require('os');
const path = require('path');

const {
  renderWidgetStrings,
  writeWidgetStrings,
} = require('../../withQariahNativeStrings');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(ROOT, 'scripts/native-strings-from-review.mjs');
const CATALOG = path.join(
  ROOT,
  'targets/widgets/_shared/Localizable.xcstrings',
);
const LOCALE_FILE = path.join(ROOT, 'i18n/native/ar.json');
const WIDGET_FILE = path.join(ROOT, 'i18n/native/widget-strings.json');
const RES = path.join(ROOT, 'android/app/src/main/res');
const INFO_PLIST_STRINGS = path.join(
  ROOT,
  'ios/Qariah/Supporting/ar.lproj/InfoPlist.strings',
);
const ANDROID_STRINGS = path.join(RES, 'values-b+ar/strings.xml');
const ANDROID_WIDGET_STRINGS = path.join(RES, 'values-ar/bayaan_widgets.xml');
const PBXPROJ = path.join(ROOT, 'ios/Qariah.xcodeproj/project.pbxproj');
// scripts/publish-to-public.sh strips planning/ from the public mirror.
const REVIEW_PACK = path.join(
  ROOT,
  'planning/pass-c/arabic-review/native-strings.csv',
);
const itWithReviewPack = existsSync(REVIEW_PACK) ? it : it.skip;

const locale = JSON.parse(readFileSync(LOCALE_FILE, 'utf8'));
const widgetStrings = JSON.parse(readFileSync(WIDGET_FILE, 'utf8'));
const APP_NAME = locale.ios.CFBundleDisplayName;

/** The format specifiers of a string, in order. */
function specifiers(text) {
  return text.match(/%(\d+\$)?(@|lld|ld|d|f)|\$\{\w+\}/g) ?? [];
}

describe('native Arabic strings', () => {
  itWithReviewPack(
    'match the review pack (the generator leaves them byte-identical)',
    () => {
      expect(() =>
        execFileSync(process.execPath, [GENERATOR, '--check'], {
          stdio: 'pipe',
        }),
      ).not.toThrow();
    },
  );

  it('name the app "قارئة" on the home screen (README decision 1)', () => {
    expect(APP_NAME).toBe('قارئة');
    expect(locale.android.app_name).toBe(APP_NAME);
  });

  it('app.config.ts gives the Arabic files to Expo and the plugin', () => {
    const config = readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8');
    expect(config).toMatch(/locales:\s*{\s*ar:\s*'\.\/i18n\/native\/ar\.json'/);
    expect(config).toContain("'./withQariahNativeStrings.js'");
  });

  it('the committed prebuild output equals what Expo writes', () => {
    // @expo/config-plugins ios/Locales.js and android/Locales.js.
    expect(readFileSync(INFO_PLIST_STRINGS, 'utf8')).toBe(
      Object.entries(locale.ios)
        .map(([key, value]) => `${key} = "${value}";`)
        .join('\n'),
    );
    const xml = readFileSync(ANDROID_STRINGS, 'utf8');
    for (const [name, value] of Object.entries(locale.android)) {
      expect(xml).toContain(`<string name="${name}">"${value}"</string>`);
    }
  });

  it('the committed widget resources equal what the plugin writes', () => {
    expect(Object.keys(widgetStrings)).toEqual(['ar']);
    expect(readFileSync(ANDROID_WIDGET_STRINGS, 'utf8')).toBe(
      renderWidgetStrings(widgetStrings.ar),
    );
  });

  it('replace only widget strings that Android already has', () => {
    // A name with no default (the library or the app's values/) would
    // never show; the generator checks the English against these files.
    const defaults = [
      path.join(
        ROOT,
        'modules/bayaan-widgets/android/src/main/res/values/strings.xml',
      ),
      path.join(RES, 'values/bayaan_widgets.xml'),
    ]
      .map(file => readFileSync(file, 'utf8'))
      .join('\n');
    for (const name of Object.keys(widgetStrings.ar)) {
      expect(defaults).toContain(`<string name="${name}">`);
    }
    // One name in two Arabic files would be a duplicate-resource error.
    for (const name of Object.keys(locale.android)) {
      expect(widgetStrings.ar).not.toHaveProperty(name);
    }
  });

  it('the app target copies ar.lproj/InfoPlist.strings', () => {
    const pbxproj = readFileSync(PBXPROJ, 'utf8');
    expect(pbxproj).toMatch(
      /\/\* InfoPlist\.strings \*\/ = {isa = PBXFileReference;[^}]*path = ar\.lproj\/InfoPlist\.strings;/,
    );
    expect(pbxproj).toMatch(
      /\t\t\t\t\w+ \/\* InfoPlist\.strings in Resources \*\/,\n/,
    );
  });

  describe('withQariahNativeStrings', () => {
    it('escapes XML and Android quoting, and keeps lint quiet', () => {
      const xml = renderWidgetStrings({a_b: 'It\'s <5> & "ok"', c: '@x'});
      expect(xml).toContain('tools:ignore="ExtraTranslation"');
      expect(xml).toContain(
        '<string name="a_b">It\\\'s &lt;5&gt; &amp; \\"ok\\"</string>',
      );
      expect(xml).toContain('<string name="c">\\@x</string>');
    });

    it('rejects a bad resource name or language', () => {
      expect(() => renderWidgetStrings({'Bad-Name': 'x'})).toThrow();
      expect(() => writeWidgetStrings('/nonexistent', {arabic: {}})).toThrow();
    });

    it('removes its file for a language that is gone, and nothing else', () => {
      const res = mkdtempSync(path.join(os.tmpdir(), 'qariah-res-'));
      try {
        writeWidgetStrings(res, {ar: {x: 'س'}, fr: {x: 'f'}});
        // The upstream plugin's file has no marker and must stay.
        writeFileSync(path.join(res, 'values-fr', 'other.xml'), '<resources/>');
        writeWidgetStrings(res, {ar: {x: 'س'}});
        expect(
          existsSync(path.join(res, 'values-ar', 'bayaan_widgets.xml')),
        ).toBe(true);
        expect(
          existsSync(path.join(res, 'values-fr', 'bayaan_widgets.xml')),
        ).toBe(false);
        expect(existsSync(path.join(res, 'values-fr', 'other.xml'))).toBe(true);
      } finally {
        rmSync(res, {recursive: true, force: true});
      }
    });
  });

  describe('String Catalog', () => {
    const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
    const entries = Object.entries(catalog.strings);

    it('has Arabic for each key that Qariah rewords in English', () => {
      const missing = entries
        .filter(([, entry]) => entry.localizations?.en)
        .filter(([, entry]) => !entry.localizations.ar)
        .map(([key]) => key);
      expect(missing).toEqual([]);
    });

    it('never says Bayaan in Arabic, and names the app as decision 1 says', () => {
      for (const [key, entry] of entries) {
        const ar = entry.localizations?.ar?.stringUnit?.value;
        if (ar === undefined) continue;
        expect(ar).not.toMatch(/Bayaan/);
        if (/Bayaan|%@ to set up|^Open %@$/.test(key)) {
          expect([key, ar]).toEqual([key, expect.stringContaining(APP_NAME)]);
        }
      }
    });

    it('keeps the format specifiers of each key', () => {
      // A value with a specifier that the key lacks reads a missing argument
      // at run time. A value may drop %@ only where it names the app.
      for (const [key, entry] of entries) {
        const ar = entry.localizations?.ar?.stringUnit?.value;
        if (ar === undefined) continue;
        const want = specifiers(key);
        const got = specifiers(ar);
        if (got.length < want.length) {
          expect(ar).toContain(APP_NAME);
          expect(want.filter(s => s !== '%@')).toEqual(
            got.filter(s => s !== '%@'),
          );
        } else {
          expect([key, got]).toEqual([key, want]);
        }
      }
    });
  });
});
