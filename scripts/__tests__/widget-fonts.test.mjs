// @ai
//
// Tests for scripts/lib/widget-fonts.mjs, scripts/check-widget-fonts.mjs and
// the wiring of the font steps in the build scripts (Sprint 51): a release
// build must hold the widget fonts, and the scripts must copy and check them.
// The tests build small zip files and folders in a temp folder. They need no
// build, no `zip` tool and no device.
//
// Run:  node --test scripts/__tests__/widget-fonts.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {Buffer} from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {
  ANDROID_FONT_FILES,
  IOS_FONT_FILES,
  WIDGET_APPEX,
  artifactKind,
  checkWidgetFonts,
  describeResult,
  listZipEntries,
  treeHasWidgets,
} from '../lib/widget-fonts.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = path.join(ROOT, 'scripts', 'check-widget-fonts.mjs');
const FONT_BYTES = Buffer.from('font');

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'qariah-widget-fonts-'));
}

/** Write an unsigned 64-bit little-endian number (the tests use small values). */
function write64(buffer, value, at) {
  buffer.writeUInt32LE(value, at);
  buffer.writeUInt32LE(0, at + 4);
}

/**
 * Write a zip file with stored (not compressed) entries. `entries` maps a name
 * to a Buffer. With `zip64` the file uses the zip64 end records and the zip64
 * extra field, as a large file does.
 */
function writeZip(file, entries, {zip64 = false} = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);

    const extra = Buffer.alloc(zip64 ? 12 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(8, 2);
      write64(extra, data.length, 4);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes, extra);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(entries).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  const tail = [directory];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    write64(record, 44, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    write64(record, count, 24);
    write64(record, count, 32);
    write64(record, directory.length, 40);
    write64(record, offset, 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    write64(locator, offset + directory.length, 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  tail.push(end);
  writeFileSync(file, Buffer.concat([...parts, ...tail]));
}

/** The zip entries of a build that has every font under `prefix`. */
function fontEntries(prefix, fonts = ANDROID_FONT_FILES) {
  return Object.fromEntries(fonts.map(font => [prefix + font, FONT_BYTES]));
}

/** Where the widget module puts its own assets, for each kind of Android build. */
const WIDGET_ASSETS = {aab: 'base/assets/widgets/', apk: 'assets/widgets/'};
const FONT_DIRS = {aab: 'base/assets/fonts/', apk: 'assets/fonts/'};

/** The entries of an Android build that has the widget module and these fonts. */
function androidBuild(kind, fonts = ANDROID_FONT_FILES) {
  return {
    [`${WIDGET_ASSETS[kind]}ayat.json`]: FONT_BYTES,
    ...fontEntries(FONT_DIRS[kind], fonts),
  };
}

/** The entries of a build from before the widgets: other assets, no widget module. */
function preWidgetBuild(kind) {
  return {
    [`${kind === 'aab' ? 'base/' : ''}assets/app.config`]: FONT_BYTES,
    [`${kind === 'aab' ? 'base/' : ''}res/raw/assets_fonts_manropebold.ttf`]:
      FONT_BYTES,
  };
}

/** A source tree with or without the widget module. */
function writeTree(dir, {android = true, ios = true} = {}) {
  if (android) {
    mkdirSync(path.join(dir, 'modules', 'bayaan-widgets', 'android'), {
      recursive: true,
    });
  }
  if (ios) mkdirSync(path.join(dir, 'targets', 'widgets'), {recursive: true});
  return dir;
}

/** An .xcarchive folder with the app, the widget and the share extension. */
function writeArchive(
  dir,
  {widgetFonts = IOS_FONT_FILES, shareFonts = [], widget = true} = {},
) {
  const plugins = path.join(
    dir,
    'Products',
    'Applications',
    'Qariah.app',
    'PlugIns',
  );
  const put = (appex, fonts, size = FONT_BYTES) => {
    mkdirSync(path.join(plugins, appex), {recursive: true});
    writeFileSync(path.join(plugins, appex, 'Info.plist'), '<plist/>');
    for (const font of fonts)
      writeFileSync(path.join(plugins, appex, font), size);
  };
  put('ShareExtension.appex', shareFonts);
  if (widget) put(WIDGET_APPEX, widgetFonts);
  return plugins;
}

describe('listZipEntries', () => {
  it('lists the names and the sizes of a zip file', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'a.zip');
      writeZip(file, {
        'a/b.txt': Buffer.from('hello'),
        'c.bin': Buffer.alloc(0),
      });
      assert.deepEqual(listZipEntries(file), [
        {name: 'a/b.txt', size: 5},
        {name: 'c.bin', size: 0},
      ]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('reads a zip64 file', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'a64.zip');
      writeZip(
        file,
        {'x.txt': Buffer.from('abc'), 'y.txt': Buffer.from('abcdef')},
        {zip64: true},
      );
      assert.deepEqual(listZipEntries(file), [
        {name: 'x.txt', size: 3},
        {name: 'y.txt', size: 6},
      ]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('throws on a file that is not a zip file', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'not.zip');
      writeFileSync(file, 'this is not a zip file at all, only text');
      assert.throws(() => listZipEntries(file), /not a zip file/);
      const tiny = path.join(dir, 'tiny.zip');
      writeFileSync(tiny, 'x');
      assert.throws(() => listZipEntries(tiny), /not a zip file/);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('artifactKind', () => {
  it('names the three kinds of build', () => {
    assert.equal(artifactKind('/x/app-release.apk'), 'apk');
    assert.equal(artifactKind('/x/app-release.AAB'), 'aab');
    assert.equal(artifactKind('/x/Qariah-3.2.2-1.xcarchive'), 'xcarchive');
    assert.equal(artifactKind('/x/Qariah-3.2.2-1.xcarchive/'), 'xcarchive');
  });
  it('throws on any other name', () => {
    assert.throws(() => artifactKind('/x/Qariah.ipa'), /expected an .apk/);
  });
});

describe('an Android build', () => {
  const kinds = ['aab', 'apk'];
  const withTemp = body => {
    const dir = tempDir();
    try {
      body(dir);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };

  for (const kind of kinds) {
    const prefix = FONT_DIRS[kind];

    it(`passes a .${kind} that holds every font`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, androidBuild(kind));
        const result = checkWidgetFonts(file);
        assert.equal(result.ok, true);
        assert.equal(result.skipped, false);
        assert.equal(result.kind, kind);
        assert.deepEqual(result.missing, []);
        assert.match(describeResult(result)[0], /^ok /);
      });
    });
    it(`fails a .${kind} with no font, as the builds 3490 and 3506 had`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        // What the shipped builds held: the widget JSON, and the app fonts as raw resources.
        writeZip(file, {
          ...preWidgetBuild(kind),
          [`${WIDGET_ASSETS[kind]}ayat.json`]: FONT_BYTES,
        });
        const result = checkWidgetFonts(file);
        assert.equal(result.ok, false);
        assert.equal(result.skipped, false);
        assert.deepEqual(result.missing, [...ANDROID_FONT_FILES]);
        const text = describeResult(result).join('\n');
        assert.match(text, /^FAIL /);
        assert.match(text, /DigitalKhattFont\.otf/);
        assert.match(text, new RegExp(prefix.replaceAll('/', '\\/')));
      });
    });
    it(`names each missing font of a .${kind}`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, androidBuild(kind, ['DigitalKhattFont.otf']));
        const result = checkWidgetFonts(file);
        assert.equal(result.ok, false);
        assert.deepEqual(result.missing, ['ScheherazadeNew-Regular.ttf']);
      });
    });
    it(`fails a .${kind} with an empty font`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, {
          ...androidBuild(kind),
          [`${prefix}ScheherazadeNew-Regular.ttf`]: Buffer.alloc(0),
        });
        const result = checkWidgetFonts(file);
        assert.equal(result.ok, false);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.empty, ['ScheherazadeNew-Regular.ttf']);
        assert.match(
          describeResult(result).join('\n'),
          /empty in .*ScheherazadeNew-Regular\.ttf/,
        );
      });
    });
    it(`does not need surah_names.ttf in a .${kind} (no Android widget code loads it)`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, androidBuild(kind));
        assert.equal(checkWidgetFonts(file).ok, true);
        // The copy is harmless, and it does not change the result.
        writeZip(
          file,
          androidBuild(kind, [...ANDROID_FONT_FILES, 'surah_names.ttf']),
        );
        assert.equal(checkWidgetFonts(file).ok, true);
      });
    });
    it(`skips a .${kind} that has no widget module, even with no font`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, preWidgetBuild(kind));
        const result = checkWidgetFonts(file);
        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
        assert.match(describeResult(result)[0], /^skip /);
        assert.match(describeResult(result)[0], /no widget module/);
      });
    });
    it(`fails a .${kind} that has no widget module when the caller requires it`, () => {
      withTemp(dir => {
        const file = path.join(dir, `app.${kind}`);
        writeZip(file, preWidgetBuild(kind));
        const result = checkWidgetFonts(file, {requireWidgets: true});
        assert.equal(result.ok, false);
        assert.equal(result.skipped, false);
        const text = describeResult(result).join('\n');
        assert.match(text, /^FAIL /);
        assert.match(text, /source tree holds the widget module/);
      });
    });
  }
  it('does not accept the AAB folder in an APK, or the APK folder in an AAB', () => {
    withTemp(dir => {
      const apk = path.join(dir, 'app.apk');
      writeZip(apk, {
        'assets/widgets/ayat.json': FONT_BYTES,
        ...fontEntries('base/assets/fonts/'),
      });
      assert.equal(checkWidgetFonts(apk).ok, false);
      const aab = path.join(dir, 'app.aab');
      writeZip(aab, {
        'base/assets/widgets/ayat.json': FONT_BYTES,
        ...fontEntries('assets/fonts/'),
      });
      assert.equal(checkWidgetFonts(aab).ok, false);
    });
  });
  it('reads the fonts of a zip64 AAB', () => {
    withTemp(dir => {
      const aab = path.join(dir, 'app64.aab');
      writeZip(aab, androidBuild('aab'), {zip64: true});
      assert.equal(checkWidgetFonts(aab).ok, true);
    });
  });
});

describe('treeHasWidgets', () => {
  it('finds the widget module of a source tree', () => {
    const dir = tempDir();
    try {
      assert.equal(treeHasWidgets('aab', dir), false);
      assert.equal(treeHasWidgets('xcarchive', dir), false);
      writeTree(dir, {android: true, ios: false});
      assert.equal(treeHasWidgets('aab', dir), true);
      assert.equal(treeHasWidgets('apk', dir), true);
      assert.equal(treeHasWidgets('xcarchive', dir), false);
      writeTree(dir, {android: false, ios: true});
      assert.equal(treeHasWidgets('xcarchive', dir), true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('finds the widget module of this repository', () => {
    assert.equal(treeHasWidgets('aab', ROOT), true);
    assert.equal(treeHasWidgets('xcarchive', ROOT), true);
  });
});

describe('an iOS archive', () => {
  it('passes an archive whose widget holds every font', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive);
      const result = checkWidgetFonts(archive);
      assert.equal(result.ok, true);
      assert.equal(result.kind, 'xcarchive');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('fails an archive whose widget holds no font, as the builds 3490 and 3506 had', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive, {widgetFonts: []});
      const result = checkWidgetFonts(archive);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, [...IOS_FONT_FILES]);
      assert.match(
        describeResult(result).join('\n'),
        /BayaanWidgetsExtension\.appex/,
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('reads the widget extension, not another extension', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive, {widgetFonts: [], shareFonts: IOS_FONT_FILES});
      assert.equal(checkWidgetFonts(archive).ok, false);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('names the fonts that are missing or empty', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      const plugins = writeArchive(archive, {
        widgetFonts: ['DigitalKhattFont.otf'],
      });
      writeFileSync(path.join(plugins, WIDGET_APPEX, 'surah_names.ttf'), '');
      const result = checkWidgetFonts(archive);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, ['ScheherazadeNew-Regular.ttf']);
      assert.deepEqual(result.empty, ['surah_names.ttf']);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('skips an archive that has no widget extension (a line from before the widgets)', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive, {widget: false});
      const result = checkWidgetFonts(archive);
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
      assert.match(describeResult(result)[0], /^skip /);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('fails an archive that has no widget extension when the caller requires it', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive, {widget: false});
      const result = checkWidgetFonts(archive, {requireWidgets: true});
      assert.equal(result.ok, false);
      assert.match(
        describeResult(result).join('\n'),
        /no widget module \(no PlugIns\/BayaanWidgetsExtension\.appex\)/,
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('needs surah_names.ttf (the "icomoon" font of the surah glyph)', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Qariah.xcarchive');
      writeArchive(archive, {
        widgetFonts: IOS_FONT_FILES.filter(font => font !== 'surah_names.ttf'),
      });
      const result = checkWidgetFonts(archive);
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, ['surah_names.ttf']);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('throws on a folder that is not an archive', () => {
    const dir = tempDir();
    try {
      const archive = path.join(dir, 'Empty.xcarchive');
      mkdirSync(archive);
      assert.throws(
        () => checkWidgetFonts(archive),
        /no Products\/Applications/,
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('scripts/check-widget-fonts.mjs', () => {
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: {...process.env, SKIP_WIDGET_FONT_CHECK: '', ...env},
    });
  const withTemp = body => {
    const dir = tempDir();
    try {
      body(dir);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };

  it('exits 0 for a build with the fonts', () => {
    withTemp(dir => {
      const aab = path.join(dir, 'app.aab');
      writeZip(aab, androidBuild('aab'));
      const result = run([aab]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^ok /);
    });
  });
  it('exits 1 and says how to fix it for a build without the fonts', () => {
    withTemp(dir => {
      const good = path.join(dir, 'good.aab');
      writeZip(good, androidBuild('aab'));
      const bad = path.join(dir, 'bad.apk');
      writeZip(bad, {'assets/widgets/ayat.json': FONT_BYTES});
      const result = run([good, bad]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /FAIL {2}bad\.apk/);
      assert.match(result.stderr, /sync-widget-fonts\.js/);
    });
  });
  it('exits 0 and prints "skip" for a build from before the widgets', () => {
    withTemp(dir => {
      const aab = path.join(dir, 'old.aab');
      writeZip(aab, preWidgetBuild('aab'));
      const result = run([aab]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^skip {2}old\.aab/);
    });
  });
  it('with --root, fails a build with no widget module when the tree has one', () => {
    withTemp(dir => {
      const aab = path.join(dir, 'old.aab');
      writeZip(aab, preWidgetBuild('aab'));
      const widgetTree = writeTree(path.join(dir, 'with'));
      const result = run(['--root', widgetTree, aab]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /source tree holds the widget module/);
      // A tree without the widget module (a line from before the widgets) skips.
      const oldTree = path.join(dir, 'without');
      mkdirSync(oldTree);
      assert.equal(run(['--root', oldTree, aab]).status, 0);
    });
  });
  it('with --root, still passes a build that has the fonts', () => {
    withTemp(dir => {
      const aab = path.join(dir, 'app.aab');
      writeZip(aab, androidBuild('aab'));
      assert.equal(
        run(['--root', writeTree(path.join(dir, 'tree')), aab]).status,
        0,
      );
    });
  });
  it('SKIP_WIDGET_FONT_CHECK=1 passes a build without the fonts and prints a WARNING', () => {
    withTemp(dir => {
      const bad = path.join(dir, 'bad.aab');
      writeZip(bad, {'base/assets/widgets/ayat.json': FONT_BYTES});
      assert.equal(run([bad]).status, 1);
      const skipped = run([bad], {SKIP_WIDGET_FONT_CHECK: '1'});
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.match(skipped.stderr, /^WARNING: SKIP_WIDGET_FONT_CHECK=1/);
      assert.match(skipped.stderr, /bad\.aab/);
      assert.doesNotMatch(skipped.stderr, /FAIL/);
      // Only the value 1 turns the check off.
      assert.equal(run([bad], {SKIP_WIDGET_FONT_CHECK: '0'}).status, 1);
      assert.equal(run([bad], {SKIP_WIDGET_FONT_CHECK: 'true'}).status, 1);
    });
  });
  it('exits 2 for a wrong call, a missing file or a file that is not a zip file', () => {
    assert.equal(run([]).status, 2);
    assert.equal(run(['--help']).status, 2);
    assert.equal(run(['--root']).status, 2);
    withTemp(dir => {
      assert.equal(run([path.join(dir, 'missing.aab')]).status, 2);
      const text = path.join(dir, 'text.aab');
      writeFileSync(text, 'not a zip file, only some text');
      const result = run([text]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /ERROR/);
      assert.equal(run([path.join(dir, 'a.ipa')]).status, 2);
      // A wrong call is a wrong call, with the check turned off too.
      assert.equal(run([], {SKIP_WIDGET_FONT_CHECK: '1'}).status, 2);
    });
  });
});

describe('the font list matches the rest of the repository', () => {
  const syncSource = readFileSync(
    path.join(ROOT, 'scripts', 'sync-widget-fonts.js'),
    'utf8',
  );
  const destinations = [...syncSource.matchAll(/'([^']+\.(?:otf|ttf))'/g)]
    .map(match => match[1])
    .filter(
      file =>
        file.startsWith('targets/widgets/') || file.includes('/assets/fonts/'),
    );

  it('lists the Android fonts that the widget code loads, and nothing else', () => {
    // Every "fonts/<file>" asset name in the Kotlin code of the widget module.
    const kotlin = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.kt')) kotlin.push(full);
      }
    };
    walk(
      path.join(ROOT, 'modules', 'bayaan-widgets', 'android', 'src', 'main'),
    );
    const loaded = new Set();
    for (const file of kotlin) {
      for (const match of readFileSync(file, 'utf8').matchAll(
        /"fonts\/([^"]+)"/g,
      )) {
        loaded.add(match[1]);
      }
    }
    assert.deepEqual([...loaded].sort(), [...ANDROID_FONT_FILES].sort());
    // surah_names.ttf is copied into the Android assets, but no Kotlin file loads it.
    assert.equal(loaded.has('surah_names.ttf'), false);
  });
  it('lists only Android fonts that sync-widget-fonts.js copies', () => {
    const android = destinations
      .filter(file =>
        file.startsWith(
          'modules/bayaan-widgets/android/src/main/assets/fonts/',
        ),
      )
      .map(file => path.basename(file));
    for (const font of ANDROID_FONT_FILES) {
      assert.ok(android.includes(font), `${font} must be in the sync script`);
    }
  });
  it('needs surah_names.ttf on iOS because it is the "icomoon" font of the surah glyph', () => {
    const chrome = readFileSync(
      path.join(ROOT, 'targets', 'widgets', 'Support', 'WidgetChrome.swift'),
      'utf8',
    );
    assert.match(chrome, /\.custom\("icomoon"/);
    const font = readFileSync(
      path.join(ROOT, 'assets', 'fonts', 'surah_names.ttf'),
    );
    assert.ok(
      font.includes('icomoon'),
      'surah_names.ttf is not the icomoon font',
    );
    assert.ok(IOS_FONT_FILES.includes('surah_names.ttf'));
  });
  it('lists the iOS fonts that sync-widget-fonts.js copies', () => {
    const ios = destinations
      .filter(file => file.startsWith('targets/widgets/'))
      .map(file => path.basename(file));
    assert.deepEqual([...ios].sort(), [...IOS_FONT_FILES].sort());
  });
  it('lists the fonts that the widget Info.plist loads (UIAppFonts)', () => {
    const plist = readFileSync(
      path.join(ROOT, 'targets', 'widgets', 'Info.plist'),
      'utf8',
    );
    const block = plist.match(
      /<key>UIAppFonts<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    assert.ok(block, 'UIAppFonts is missing from targets/widgets/Info.plist');
    const fonts = [...block[1].matchAll(/<string>([^<]+)<\/string>/g)].map(
      match => match[1],
    );
    assert.deepEqual([...fonts].sort(), [...IOS_FONT_FILES].sort());
  });
  it('names the widget extension of targets/widgets/expo-target.config.js', () => {
    const config = readFileSync(
      path.join(ROOT, 'targets', 'widgets', 'expo-target.config.js'),
      'utf8',
    );
    assert.match(
      config,
      new RegExp(`name: '${WIDGET_APPEX.replace('.appex', '')}'`),
    );
  });
  it('keeps every copied font out of git', t => {
    const copies = destinations;
    assert.ok(copies.length > 0, 'no font copy found in sync-widget-fonts.js');
    try {
      execFileSync('git', ['-C', ROOT, 'rev-parse', '--git-dir'], {
        stdio: 'ignore',
      });
    } catch {
      t.skip('not a git checkout');
      return;
    }
    for (const file of copies) {
      const ignored = spawnSync('git', [
        '-C',
        ROOT,
        'check-ignore',
        '-q',
        file,
      ]);
      assert.equal(ignored.status, 0, `${file} must be in .gitignore`);
    }
  });
});

describe('the build scripts copy and check the widget fonts', () => {
  const read = name => readFileSync(path.join(ROOT, 'scripts', name), 'utf8');
  const at = (text, needle) => {
    const index = text.indexOf(needle);
    assert.notEqual(index, -1, `${needle} is missing`);
    return index;
  };

  it('android-archive.sh copies the fonts before Gradle, and checks the APK and the AAB', () => {
    const text = read('android-archive.sh');
    const sync = at(text, 'node "$SCRIPT_DIR/sync-widget-fonts.js"');
    const apk = at(text, '\n./gradlew assembleRelease -P');
    const aab = at(text, '\n    ./gradlew bundleRelease\n');
    const checkApk = at(
      text,
      'check-widget-fonts.mjs" --root "$REPO_ROOT" "$APK_PATH"',
    );
    const checkAab = at(
      text,
      'check-widget-fonts.mjs" --root "$REPO_ROOT" "$AAB_PATH"',
    );
    const archive = at(text, 'Durable archive');
    const upload = at(text, 'android-upload-play.sh" --track');
    assert.ok(sync < apk, 'the copy must run before the first Gradle build');
    assert.ok(
      apk < checkApk && checkApk < aab,
      'check the APK after it is built',
    );
    assert.ok(
      aab < checkAab && checkAab < upload,
      'check the AAB before the upload',
    );
    assert.ok(
      checkApk < archive,
      'check the APK before the durable archive copy',
    );
  });
  it('android-archive.sh deletes a failed APK and a failed AAB before it exits', () => {
    const text = read('android-archive.sh');
    for (const variable of ['APK_PATH', 'AAB_PATH']) {
      const check = at(
        text,
        `check-widget-fonts.mjs" --root "$REPO_ROOT" "$${variable}"`,
      );
      const failure = text.slice(check, text.indexOf('exit 1', check));
      assert.ok(
        failure.includes(`rm -f "$${variable}"`),
        `${variable} must be deleted in the failure branch`,
      );
    }
  });
  it('qariah-ios-archive.sh copies the fonts after the dry run and before the child archive', () => {
    const text = read('qariah-ios-archive.sh');
    const dryRun = at(text, 'Dry run: the identity this archive would build');
    const dryRunExit = text.indexOf('exit 0', dryRun);
    const sync = at(text, 'node "$SCRIPT_DIR/sync-widget-fonts.js"');
    const child = at(text, 'bash "$SCRIPT_DIR/ios-archive.sh"');
    assert.ok(dryRunExit > dryRun, 'the dry run block has no exit 0');
    assert.ok(dryRunExit < sync, 'a dry run must not copy the fonts');
    assert.ok(sync < child, 'copy the fonts before the child archives');
  });
  it('ios-archive.sh checks the archive before the export and the upload', () => {
    const text = read('ios-archive.sh');
    const created = at(text, 'Archive created at');
    const check = at(
      text,
      '/check-widget-fonts.mjs" --root . "$ARCHIVE_PATH" || exit 1',
    );
    const exportStep = at(text, 'EXPORT_CMD=(xcodebuild -exportArchive');
    const upload = at(text, 'xcrun altool --upload-app');
    assert.ok(created < check && check < exportStep && exportStep < upload);
  });
  it('bootstrap-worktree.sh copies the fonts', () => {
    assert.match(
      read('bootstrap-worktree.sh'),
      /^\s+node "\$HERE\/scripts\/sync-widget-fonts\.js"$/m,
    );
  });
  it('android-upload-play.sh checks the AAB before it reads a secret or calls Google', () => {
    const text = read('android-upload-play.sh');
    const missing = at(text, 'AAB not found:');
    const check = at(
      text,
      'node "$SCRIPT_DIR/check-widget-fonts.mjs" "$AAB_PATH"',
    );
    const env = at(text, 'ENV_LOCAL="$REPO_ROOT/.env.local"');
    const token = at(text, 'Requesting OAuth2 access token');
    const upload = at(text, '/bundles?ackBundleInstallationWarning');
    assert.ok(missing < check && check < env && env < token && token < upload);
    // The failure branch stops the script and names the way to skip the check.
    const failure = text.slice(check, text.indexOf('\nfi\n', check));
    assert.match(failure, /exit 1/);
    assert.match(failure, /SKIP_WIDGET_FONT_CHECK=1/);
  });
});

describe('android-upload-play.sh with the widget font check', () => {
  // The tests run a copy of the script in a temp tree. The tree has no .env.local,
  // no credentials and no Google helper, and HOME is an empty temp folder. So a
  // run that passes the font check stops at "Service-account JSON not found",
  // and no run can reach a secret or the network.
  function upload(dir, aabEntries, env = {}) {
    const scripts = path.join(dir, 'scripts');
    mkdirSync(path.join(scripts, 'lib'), {recursive: true});
    for (const name of ['android-upload-play.sh', 'check-widget-fonts.mjs']) {
      copyFileSync(path.join(ROOT, 'scripts', name), path.join(scripts, name));
    }
    copyFileSync(
      path.join(ROOT, 'scripts', 'lib', 'widget-fonts.mjs'),
      path.join(scripts, 'lib', 'widget-fonts.mjs'),
    );
    const home = path.join(dir, 'home');
    mkdirSync(home);
    const aab = path.join(dir, 'app-release.aab');
    writeZip(aab, aabEntries);
    const base = {...process.env, HOME: home, SKIP_WIDGET_FONT_CHECK: ''};
    delete base.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    const result = spawnSync(
      'bash',
      [path.join(scripts, 'android-upload-play.sh'), '--track=internal', aab],
      {encoding: 'utf8', cwd: dir, env: {...base, ...env}, timeout: 20000},
    );
    return {status: result.status, out: `${result.stdout}${result.stderr}`};
  }
  const withTemp = body => {
    const dir = tempDir();
    try {
      body(dir);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };
  const STOPPED_AT_CHECK = 'The AAB has no widget fonts. Not uploading.';
  const PASSED_CHECK = 'Service-account JSON not found';

  it('refuses an AAB that has the widget module but not the fonts', () => {
    withTemp(dir => {
      const {status, out} = upload(dir, {
        'base/assets/widgets/ayat.json': FONT_BYTES,
      });
      assert.equal(status, 1);
      assert.ok(out.includes(STOPPED_AT_CHECK), out);
      assert.ok(out.includes('SKIP_WIDGET_FONT_CHECK=1'), out);
      assert.ok(!out.includes(PASSED_CHECK), out);
    });
  });
  it('passes an AAB that has the fonts', () => {
    withTemp(dir => {
      const {status, out} = upload(dir, androidBuild('aab'));
      assert.equal(status, 1);
      assert.ok(out.includes(PASSED_CHECK), out);
      assert.ok(!out.includes(STOPPED_AT_CHECK), out);
    });
  });
  it('passes an AAB from before the widgets (hotfix/3.2.0-anr-splash)', () => {
    withTemp(dir => {
      const {status, out} = upload(dir, preWidgetBuild('aab'));
      assert.equal(status, 1);
      assert.ok(out.includes(PASSED_CHECK), out);
      assert.ok(!out.includes(STOPPED_AT_CHECK), out);
      assert.match(out, /skip {2}app-release\.aab/);
    });
  });
  it('SKIP_WIDGET_FONT_CHECK=1 passes an AAB without the fonts and prints a WARNING', () => {
    withTemp(dir => {
      const {status, out} = upload(
        dir,
        {'base/assets/widgets/ayat.json': FONT_BYTES},
        {SKIP_WIDGET_FONT_CHECK: '1'},
      );
      assert.equal(status, 1);
      assert.ok(out.includes('WARNING: SKIP_WIDGET_FONT_CHECK=1'), out);
      assert.ok(out.includes(PASSED_CHECK), out);
      assert.ok(!out.includes(STOPPED_AT_CHECK), out);
    });
  });
});
