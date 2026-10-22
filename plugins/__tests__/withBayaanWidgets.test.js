/**
 * Unit tests for the pure parts of plugins/withBayaanWidgets.js (RFC-021):
 * config resolution, the widget target's Xcode build settings and the
 * generated Android values.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveWidgetConfig,
  applyWidgetBuildSettings,
  renderAndroidValues,
  compilationConditions,
  loadForkSources,
} = require('../withBayaanWidgets');

const ROOT = path.join(__dirname, '..', '..');
// The committed native trees must match what app.config.js would generate.
// @ai Qariah: Qariah's config is app.config.ts (upstream's app.config.js is
// deleted in the fork), and its app project is ios/Qariah.xcodeproj.
const APP_CONFIG_MODULE = require('../../app.config.ts');
const APP_CONFIG = (APP_CONFIG_MODULE.default ?? APP_CONFIG_MODULE).expo;
// @ai Qariah (Sprint 46): `ios` carries the App Group (BAYAAN_APP_GROUP).
const COMMITTED = {
  name: APP_CONFIG.name,
  scheme: APP_CONFIG.scheme,
  ios: APP_CONFIG.ios,
};

const PBXPROJ = fs.readFileSync(
  path.join(ROOT, 'ios', 'Qariah.xcodeproj', 'project.pbxproj'),
  'utf8',
);

function widgetConfigs(pbxproj) {
  const blocks = [];
  const pattern =
    /\/\* (Debug|Release) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = \{\n([\s\S]*?)\n\t\t\t\};/g;
  for (const match of pbxproj.matchAll(pattern)) {
    if (match[2].includes('INFOPLIST_FILE = ../targets/widgets/Info.plist;')) {
      blocks.push({name: match[1], body: match[2]});
    }
  }
  return blocks;
}

describe('resolveWidgetConfig', () => {
  it('defaults to Bayaan', () => {
    expect(resolveWidgetConfig({name: 'Bayaan', scheme: 'bayaan'})).toEqual(
      expect.objectContaining({scheme: 'bayaan', name: 'Bayaan'}),
    );
  });

  it('takes the first scheme and rejects invalid ones', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(resolveWidgetConfig({scheme: ['qariah', 'exp+qariah']}).scheme).toBe(
      'qariah',
    );
    expect(resolveWidgetConfig({scheme: '1bad'}).scheme).toBe('bayaan');
    expect(resolveWidgetConfig({}).scheme).toBe('bayaan');
    warn.mockRestore();
  });
});

describe('applyWidgetBuildSettings', () => {
  it('leaves the committed project unchanged for the default config', () => {
    const config = resolveWidgetConfig(COMMITTED, loadForkSources(ROOT));
    expect(applyWidgetBuildSettings(PBXPROJ, config)).toBe(PBXPROJ);
  });

  it('writes a fork scheme into both widget configurations only', () => {
    const config = resolveWidgetConfig({name: 'Qariah', scheme: 'qariah'});
    const out = applyWidgetBuildSettings(PBXPROJ, config);
    const blocks = widgetConfigs(out);
    expect(blocks.map(b => b.name).sort()).toEqual(['Debug', 'Release']);
    for (const block of blocks) {
      expect(block.body).toContain('\t\t\t\tBAYAAN_URL_SCHEME = qariah;');
      expect(block.body).not.toContain('BAYAAN_URL_SCHEME = bayaan;');
    }
    expect(out.match(/BAYAAN_URL_SCHEME/g)).toHaveLength(2);
    expect(applyWidgetBuildSettings(out, config)).toBe(out);
  });

  it('inserts the setting in alphabetical order when missing', () => {
    const stripped = PBXPROJ.replace(/\t\t\t\tBAYAAN_URL_SCHEME = \w+;\n/g, '');
    const out = applyWidgetBuildSettings(
      stripped,
      resolveWidgetConfig(COMMITTED, loadForkSources(ROOT)),
    );
    expect(out).toBe(PBXPROJ);
  });

  // @ai Qariah (Sprint 46): the widget reads the app's App Group, so a
  // `.beta` extension bundle id (scripts/ios-archive.sh --beta) does not
  // derive a group that its entitlement does not allow.
  it("writes the app's App Group into both widget configurations", () => {
    const out = applyWidgetBuildSettings(
      PBXPROJ,
      resolveWidgetConfig(COMMITTED, loadForkSources(ROOT)),
    );
    const blocks = widgetConfigs(out);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.body).toContain(
        `\t\t\t\tBAYAAN_APP_GROUP = ${APP_CONFIG.ios.infoPlist.BayaanAppGroup};`,
      );
    }
    expect(out.match(/BAYAAN_APP_GROUP/g)).toHaveLength(2);
    const entitlements = fs.readFileSync(
      path.join(
        ROOT,
        'ios/.targets/BayaanWidgetsExtension/generated.entitlements',
      ),
      'utf8',
    );
    expect(entitlements).toContain(
      `<string>${APP_CONFIG.ios.infoPlist.BayaanAppGroup}</string>`,
    );
    const plist = fs.readFileSync(
      path.join(ROOT, 'targets/widgets/Info.plist'),
      'utf8',
    );
    expect(plist).toMatch(
      /<key>BayaanAppGroup<\/key>\s*<string>\$\(BAYAAN_APP_GROUP\)<\/string>/,
    );
  });

  it('derives group.<bundle id> without the key, and removes the setting with neither', () => {
    expect(
      resolveWidgetConfig({ios: {bundleIdentifier: 'org.fork.app'}}).appGroup,
    ).toBe('group.org.fork.app');
    expect(
      resolveWidgetConfig({
        ios: {
          bundleIdentifier: 'org.fork.app',
          infoPlist: {BayaanAppGroup: 'group.org.fork.shared'},
        },
      }).appGroup,
    ).toBe('group.org.fork.shared');
    const out = applyWidgetBuildSettings(PBXPROJ, resolveWidgetConfig({}));
    expect(out).not.toContain('BAYAAN_APP_GROUP');
  });

  it('fails loudly when the widget target is missing', () => {
    expect(() =>
      applyWidgetBuildSettings('// empty', resolveWidgetConfig({})),
    ).toThrow('BayaanWidgetsExtension');
  });
});

// Qariah's flag values with upstream's widget list (every widget). Qariah's
// own list is config/nativeWidgets.config.js (loadForkSources above).
const QARIAH_FLAGS = {
  widgets: undefined,
  flags: {adhkar: false, ambientAudioOverlay: false, sleepTimer: true},
};

function swiftSources(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return swiftSources(full);
    return entry.name.endsWith('.swift') ? [fs.readFileSync(full, 'utf8')] : [];
  });
}

describe('enabled widgets', () => {
  // @ai Qariah: the fork's seam values, not Bayaan's defaults (adhkar and the
  // ambient overlay are off in config/featureFlags.ts).
  it('reads nativeWidgets.config.js and featureFlags.ts', () => {
    const sources = loadForkSources(ROOT);
    const {featureFlags} = require('../../config/featureFlags');
    expect(sources.widgets).toEqual(
      require('../../config/nativeWidgets.config.js').widgets,
    );
    expect(sources.flags.adhkar).toBe(featureFlags.adhkar);
    expect(sources.flags.ambientAudioOverlay).toBe(
      featureFlags.ambientAudioOverlay,
    );
  });

  it('defines the Swift conditions for the flags Qariah turns off', () => {
    const config = resolveWidgetConfig({}, loadForkSources(ROOT));
    expect(compilationConditions(config)).toEqual(
      expect.arrayContaining([
        'BAYAAN_NO_WIDGET_TASBEEH',
        'BAYAAN_NO_WIDGET_ADHKAR',
        'BAYAAN_NO_FEATURE_ADHKAR',
        'BAYAAN_NO_FEATURE_AMBIENT',
      ]),
    );
  });

  it('defines a condition per disabled widget and feature', () => {
    const config = resolveWidgetConfig({}, QARIAH_FLAGS);
    expect(compilationConditions(config)).toEqual([
      'BAYAAN_NO_WIDGET_TASBEEH',
      'BAYAAN_NO_WIDGET_ADHKAR',
      'BAYAAN_NO_FEATURE_ADHKAR',
      'BAYAAN_NO_FEATURE_AMBIENT',
    ]);
  });

  it('uses only conditions the widget sources check', () => {
    const swift = swiftSources(path.join(ROOT, 'targets', 'widgets')).join(
      '\n',
    );
    const config = resolveWidgetConfig({}, {widgets: [], flags: {}});
    const all = [
      ...compilationConditions(config),
      'BAYAAN_NO_FEATURE_ADHKAR',
      'BAYAAN_NO_FEATURE_SLEEP_TIMER',
      'BAYAAN_NO_FEATURE_AMBIENT',
    ];
    for (const condition of all) {
      expect(swift).toContain(condition);
    }
  });

  it('adds conditions to both widget configurations and removes them again', () => {
    const fork = resolveWidgetConfig(
      {scheme: 'qariah'},
      {widgets: ['ContinueListening', 'QuickSurah'], flags: QARIAH_FLAGS.flags},
    );
    const out = applyWidgetBuildSettings(PBXPROJ, fork);
    const blocks = widgetConfigs(out);
    const debug = blocks.find(b => b.name === 'Debug').body;
    const release = blocks.find(b => b.name === 'Release').body;
    expect(debug).toMatch(
      /SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG BAYAAN_NO_WIDGET_CONTINUE_READING .*BAYAAN_NO_FEATURE_AMBIENT";/,
    );
    expect(release).toMatch(
      /SWIFT_ACTIVE_COMPILATION_CONDITIONS = "\$\(inherited\) BAYAAN_NO_WIDGET_CONTINUE_READING /,
    );
    expect(release).not.toContain('BAYAAN_NO_WIDGET_QUICK_SURAH');
    // The app target is untouched.
    expect(out.match(/BAYAAN_NO_WIDGET_CONTINUE_READING/g)).toHaveLength(2);
    expect(applyWidgetBuildSettings(out, fork)).toBe(out);

    const restored = applyWidgetBuildSettings(
      out,
      resolveWidgetConfig(COMMITTED, loadForkSources(ROOT)),
    );
    expect(restored).toBe(PBXPROJ);
  });
});

function forkProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bayaan-widgets-fork-'));
  fs.mkdirSync(path.join(root, 'config'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'config', name), contents);
  }
  return root;
}

describe('loadForkSources in a fork', () => {
  const flags = `import {extra} from './extraFlags';
export const featureFlags = {adhkar: extra, ambientAudioOverlay: false} as const;
`;

  it('never loads branding.js and resolves flag imports from config/', () => {
    const root = forkProject({
      // Node cannot load this: a plugin that required branding.js would throw.
      'branding.js':
        "module.exports = {listenTabTopComponent: require('./Top.tsx').default};",
      'Top.tsx': 'export default function Top(): JSX.Element { return <></>; }',
      'extraFlags.js': 'module.exports = {extra: false};',
      'featureFlags.ts': flags,
      'nativeWidgets.config.js':
        "module.exports = {widgets: ['ContinueListening', 'QuickSurah']};",
    });
    const sources = loadForkSources(root);
    expect(sources.widgets).toEqual(['ContinueListening', 'QuickSurah']);
    expect(sources.flags).toEqual({adhkar: false, ambientAudioOverlay: false});
  });

  it('warns about unknown widget ids', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const root = forkProject({
      'extraFlags.js': 'module.exports = {extra: true};',
      'featureFlags.ts': flags,
      'nativeWidgets.config.js':
        "module.exports = {widgets: ['QuickSurah', 'QuickSura']};",
    });
    loadForkSources(root);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown widget ids QuickSura'),
    );
    warn.mockRestore();
  });

  it('explains a missing seam file', () => {
    const root = forkProject({'featureFlags.ts': flags});
    expect(() => loadForkSources(root)).toThrow(
      /Could not read the widget seams/,
    );
  });
});

describe('renderAndroidValues', () => {
  it('turns off disabled widgets and features', () => {
    const xml = renderAndroidValues(resolveWidgetConfig({}, QARIAH_FLAGS));
    expect(xml).toContain(
      '<bool name="bayaan_widget_enabled_adhkar">false</bool>',
    );
    expect(xml).toContain(
      '<bool name="bayaan_widget_enabled_tasbeeh">false</bool>',
    );
    expect(xml).toContain(
      '<bool name="bayaan_widget_enabled_bedtime">true</bool>',
    );
    expect(xml).toContain(
      '<bool name="bayaan_widgets_feature_ambient">false</bool>',
    );
    expect(xml).toContain(
      '<string name="bayaan_widget_now_desc">What fits this moment: listening or bedtime.</string>',
    );
    expect(xml).not.toContain('live_activity');
  });

  it('matches the committed app resources for the default config', () => {
    const committed = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/res/values/bayaan_widgets.xml'),
      'utf8',
    );
    expect(
      renderAndroidValues(
        resolveWidgetConfig(COMMITTED, loadForkSources(ROOT)),
      ),
    ).toBe(committed);
  });

  it('escapes a name that starts with @ or ?', () => {
    expect(
      renderAndroidValues(resolveWidgetConfig({name: '@Qariah'}, {})),
    ).toContain(
      '<string name="bayaan_widget_now_label">\\@Qariah Now</string>',
    );
    expect(
      renderAndroidValues(resolveWidgetConfig({name: '?Qariah'}, {})),
    ).toContain(
      '<string name="bayaan_widget_now_label">\\?Qariah Now</string>',
    );
  });

  it('writes a fork scheme and name', () => {
    const xml = renderAndroidValues(
      resolveWidgetConfig({name: "Qari'ah & Co", scheme: 'qariah'}),
    );
    expect(xml).toContain(
      '<string name="bayaan_widgets_url_scheme" translatable="false">qariah</string>',
    );
    expect(xml).toContain(
      `<string name="bayaan_widget_now_label">Qari\\'ah &amp; Co Now</string>`,
    );
  });
});
