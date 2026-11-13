// @ai-generated
// Qariah (2026-11-11): the Android app shortcuts plugin (withQariahAndroidShortcuts.js).
const fs = require('fs');
const path = require('path');
const plugin = require('../../withQariahAndroidShortcuts.js');

const ROOT = path.join(__dirname, '..', '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const OPTIONS = {packageName: 'com.qariah.app', scheme: 'qariah'};

describe('withQariahAndroidShortcuts', () => {
  it('the committed resources are what the plugin writes (no drift)', () => {
    for (const [rel, text] of Object.entries(plugin.renderResources(OPTIONS))) {
      expect(fs.readFileSync(path.join(RES, rel), 'utf8')).toBe(text);
    }
  });

  it('each shortcut opens its link route in the main activity', () => {
    const xml =
      plugin.renderResources(OPTIONS)[path.join('xml', 'qariah_shortcuts.xml')];
    for (const s of plugin.SHORTCUTS) {
      expect(xml).toContain(`android:data="qariah://${s.route}"`);
      expect(fs.existsSync(path.join(ROOT, 'app', `${s.route}.tsx`))).toBe(
        true,
      );
    }
    expect(xml).toContain('android:targetClass="com.qariah.app.MainActivity"');
    expect(plugin.SHORTCUTS.map(s => s.long)).toEqual([
      'Continue listening',
      'Continue reading',
      'Search',
    ]);
  });

  it('the committed manifest names the shortcuts in the launcher activity', () => {
    const manifest = fs.readFileSync(
      path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain(
      '<meta-data android:name="android.app.shortcuts" android:resource="@xml/qariah_shortcuts"/>',
    );
  });

  it('adds the meta-data to the launcher activity once', () => {
    const launcher = {
      $: {'android:name': '.MainActivity'},
      'intent-filter': [
        {category: [{$: {'android:name': 'android.intent.category.LAUNCHER'}}]},
      ],
    };
    const other = {$: {'android:name': '.Other'}};
    const manifest = {manifest: {application: [{activity: [other, launcher]}]}};
    plugin.addShortcutsMetaData(manifest);
    plugin.addShortcutsMetaData(manifest);
    expect(launcher['meta-data']).toEqual([
      {
        $: {
          'android:name': 'android.app.shortcuts',
          'android:resource': '@xml/qariah_shortcuts',
        },
      },
    ]);
    expect(other['meta-data']).toBeUndefined();
  });

  it('reads the app scheme from the first scheme entry', () => {
    expect(plugin.appScheme({scheme: ['qariah', 'com.qariah.app']})).toBe(
      'qariah',
    );
    expect(plugin.appScheme({scheme: 'qariah'})).toBe('qariah');
    expect(() => plugin.appScheme({})).toThrow(/no app scheme/);
  });
});

// SC-12: a launch from Recents after process death must not run a shortcut again.
describe('the MainActivity history guard', () => {
  const MAIN = path.join(
    ROOT,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'qariah',
    'app',
    'MainActivity.kt',
  );

  it('the committed MainActivity has the block, before super.onCreate', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    expect(plugin.addHistoryGuard(src, 'qariah')).toBe(src);
    const guard = src.indexOf('FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf('super.onCreate(null)'));
    for (const s of plugin.SHORTCUTS) expect(src).toContain(`"${s.route}"`);
    expect(src).toContain('intent.data?.scheme == "qariah"');
  });

  it('adds the block once', () => {
    const bare =
      'class A {\n  fun onCreate() {\n    super.onCreate(null)\n  }\n}\n';
    const once = plugin.addHistoryGuard(bare, 'qariah');
    expect(plugin.addHistoryGuard(once, 'qariah')).toBe(once);
    expect(once.match(/qariah-shortcut-history/g)).toHaveLength(2);
  });
});
