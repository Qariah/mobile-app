#!/usr/bin/env node
// @ai-generated
/**
 * Writes Qariah's native Arabic strings from the Arabic review pack
 * (planning/pass-c/arabic-review/native-strings.csv, Sprint 47 Task 7).
 * Nobody types the Arabic by hand: a reviewer changes the CSV, and this
 * script writes the files.
 *
 *   node scripts/native-strings-from-review.mjs           # write
 *   node scripts/native-strings-from-review.mjs --check   # exit 1 if stale
 *
 * Outputs:
 *   - targets/widgets/_shared/Localizable.xcstrings: the "ar" localization of
 *     the widget, Live Activity, control and App Intent strings. The catalog
 *     is in the widget extension and in the app (the App Intents), so one
 *     entry serves both. The script owns every "ar" localization in it; the
 *     "en" entries (the Qariah wording of upstream keys) stay as they are.
 *   - i18n/native/ar.json: the Expo `locales` file (app.config.ts). At
 *     prebuild, Expo writes its `ios` values into
 *     ios/Qariah/Supporting/ar.lproj/InfoPlist.strings and its `android`
 *     values into android/app/src/main/res/values-b+ar/strings.xml: the
 *     home-screen name on both platforms.
 *   - i18n/native/widget-strings.json: the Android widget-picker text, by
 *     language. withQariahNativeStrings.js writes it into
 *     res/values-ar/bayaan_widgets.xml at prebuild; an app resource replaces
 *     the bayaan-widgets library resource of the same name.
 *
 * The Arabic of a row is "Reviewer: correction" when it is filled, else
 * "Suggested Arabic". A cell with several strings separates them with " / ";
 * the English and the Arabic cells split the same way.
 *
 * The script checks each English part against the text it replaces: the
 * catalog key (or its "en" value, for the keys whose Qariah English differs
 * from upstream's), or the default Android resource. A CSV placeholder
 * ({n}, {count}, {surah}, {app}) becomes the key's format specifier; the
 * Arabic must have the same placeholders as the English, except that an
 * {app} part may name the app instead (README decision 1: "تطبيق قارئة").
 * Two rows that write one key must agree. Output is stable, so a second run
 * leaves the files byte-identical.
 *
 * Plain Node (>= 18), no dependencies.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CSV_PATH = path.join(
  REPO_ROOT,
  'planning/pass-c/arabic-review/native-strings.csv',
);
const CATALOG = path.join(
  REPO_ROOT,
  'targets/widgets/_shared/Localizable.xcstrings',
);
const LOCALE_FILE = path.join(REPO_ROOT, 'i18n/native/ar.json');
const WIDGET_FILE = path.join(REPO_ROOT, 'i18n/native/widget-strings.json');
const LIBRARY_STRINGS = path.join(
  REPO_ROOT,
  'modules/bayaan-widgets/android/src/main/res/values/strings.xml',
);
const APP_VALUES = path.join(REPO_ROOT, 'android/app/src/main/res/values');
const INFO_PLIST = path.join(REPO_ROOT, 'ios/Qariah/Info.plist');

const LANGUAGE = 'ar';
const PART_SEPARATOR = ' / ';
const GENERATED_COMMENT =
  'Qariah (Sprint 47, Pass C): Arabic for upstream text (RFC-021 seam). ' +
  'scripts/native-strings-from-review.mjs writes it from ' +
  'planning/pass-c/arabic-review/native-strings.csv';

/**
 * Where each CSV row goes. A row maps to a list of parts; `part` is the
 * index in the " / "-separated cell (0 when the cell holds one string).
 *
 *   catalog:      String Catalog keys (exactly as the Swift compiler
 *                 extracts them).
 *   android:      app string resources that Expo `locales` writes (the
 *                 name has a default in the app's res/values/strings.xml).
 *   widget:       widget string resources (withQariahNativeStrings.js).
 *   ios:          Info.plist keys (Expo `locales`).
 *   placeholders: CSV placeholder → the key's format specifier.
 *   template:     wraps the part before the comparison and the output
 *                 ("{}" is the part).
 *   namesApp:     the Arabic may name the app instead of {app}.
 *   list:         the part is "Prefix: a, b or c."; keep only the items that
 *                 the current English default still has.
 *   skip:         why the part has no output.
 */
const ROWS = {
  1: [{ios: ['CFBundleDisplayName'], android: ['app_name']}],
  2: [{skip: 'beta name: kept in English (row note); see ios-archive.sh'}],
  3: [{skip: 'public beta name: kept in English (row note)'}],
  4: [{catalog: ['Pauses the recitation playing in Bayaan.']}],
  5: [{catalog: ['Play or Pause Bayaan']}],
  6: [{catalog: ['Plays a surah in Bayaan with your default reciter.']}],
  7: [
    {
      catalog: [
        'Resumes your recitation in Bayaan, or plays your most recent surah.',
      ],
    },
  ],
  8: [{widget: ['bayaan_widget_now_label']}],
  9: [{widget: ['bayaan_widget_now_desc'], list: true}],
  10: [
    {
      catalog: ['Continue Listening'],
      widget: ['bayaan_widget_continue_listening_label'],
    },
  ],
  11: [{widget: ['bayaan_widget_continue_listening_desc']}],
  12: [{catalog: ['Pick up where you left off.']}],
  13: [
    {part: 0, skip: 'ContinueListeningViews.swift passes a String, not a key'},
    {part: 1, skip: 'ContinueListeningViews.swift passes a String, not a key'},
  ],
  14: [{catalog: ['Start listening']}],
  15: [
    {
      catalog: ['Continue Reading'],
      widget: ['bayaan_widget_continue_reading_label'],
    },
  ],
  16: [
    {
      catalog: ['Return to the page you were reading.'],
      widget: ['bayaan_widget_continue_reading_desc'],
    },
  ],
  17: [
    // The standalone "Juz {n}" is a String in ContinueReadingWidget.swift
    // (`detail`); the Lock Screen line "<surah> · Juz {n}" is a key.
    {
      part: 0,
      catalog: ['%@ · Juz %lld'],
      template: '%@ · {}',
      placeholders: {n: '%lld'},
    },
    {part: 1, catalog: ['Page %lld'], placeholders: {n: '%lld'}},
    {part: 2, catalog: ['Start reading']},
    {part: 3, catalog: ['Continue reading']},
  ],
  18: [{catalog: ['Quick Surah'], widget: ['bayaan_widget_quick_surah_label']}],
  19: [
    {
      part: 0,
      catalog: ['Play a favorite surah in one tap.'],
      widget: ['bayaan_widget_quick_surah_desc'],
    },
    {part: 1, catalog: ['Play a surah in one tap.']},
  ],
  20: [
    {part: 0, catalog: ['Surah']},
    {part: 1, catalog: ['Second surah']},
    {part: 2, catalog: ['Third surah']},
    {part: 3, catalog: ['Fourth surah']},
    {part: 4, catalog: ['Reciter']},
  ],
  21: [
    // The App Intents parameter summary and the accessibility label.
    {part: 0, catalog: ['Play ${surah}'], placeholders: {surah: '${surah}'}},
    {part: 0, catalog: ['Play %@'], placeholders: {surah: '%@'}},
    {part: 1, skip: 'QuickSurahWidget.swift passes a String, not a key'},
    {
      part: 2,
      catalog: ['Open %@ to set up'],
      placeholders: {app: '%@'},
      namesApp: true,
    },
  ],
  22: [{catalog: ['Ayah of the Day'], widget: ['bayaan_widget_ayah_label']}],
  23: [
    {
      catalog: ['A new ayah every day, in Digital Khatt.'],
      widget: ['bayaan_widget_ayah_desc'],
    },
  ],
  24: [{catalog: ['Open %@'], placeholders: {app: '%@'}, namesApp: true}],
  25: [
    {part: 0, catalog: ['Play or Pause']},
    {part: 1, catalog: ['Play or pause your recitation.']},
  ],
  26: [
    {part: 0, catalog: ['Play Surah']},
    {part: 1, catalog: ['Choose the surah this control plays.']},
    {part: 2, catalog: ['Play a chosen surah with your default reciter.']},
  ],
  27: [
    {part: 0, catalog: ['Surah']},
    {part: 1, catalog: ['Reciter']},
    {part: 2, catalog: ['Rewayah']},
    {part: 3, catalog: ['Ayah']},
    {part: 4, catalog: ['Playing']},
    {part: 5, catalog: ['Play Reciter']},
    {part: 6, catalog: ['Pause Recitation']},
    {part: 7, catalog: ['Resume Recitation']},
  ],
  28: [
    // One key has one value: "Surah" and "Reciter" are also the parameter
    // titles of rows 20 and 27, which give the definite form.
    {part: 0, skip: 'same key as rows 20 and 27 ("السورة")'},
    {part: 1, skip: 'same key as rows 20 and 27 ("القارئة")'},
    {part: 2, skip: 'Entities.swift passes a String, not a key'},
  ],
  29: [
    {part: 0, catalog: ['Play']},
    {part: 1, catalog: ['Pause']},
    {
      part: 2,
      catalog: ['Ayah %lld of %lld'],
      placeholders: {n: '%lld', count: '%lld'},
    },
  ],
  30: [
    {part: 0, catalog: ['Play']},
    {part: 1, catalog: ['Pause']},
  ],
};

const CSV_PLACEHOLDER = /{(\w+)}/g;

function fail(message) {
  console.error(`native-strings-from-review: ${message}`);
  process.exit(1);
}

/** RFC 4180: quoted cells may hold commas, quotes ("") and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function readRows() {
  const text = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const [header, ...data] = parseCsv(text);
  const col = name => {
    const index = header.indexOf(name);
    if (index < 0) fail(`${CSV_PATH} has no column "${name}"`);
    return index;
  };
  const number = col('#');
  const english = col('English');
  const suggested = col('Suggested Arabic');
  const correction = col('Reviewer: correction');
  const rows = new Map();
  for (const cells of data) {
    if (cells.every(c => c.trim() === '')) continue;
    const n = Number(cells[number]);
    rows.set(n, {
      n,
      english: cells[english].trim(),
      arabic: (cells[correction].trim() || cells[suggested]).trim(),
    });
  }
  return rows;
}

function splitParts(row) {
  const english = row.english.split(PART_SEPARATOR);
  const arabic = row.arabic.split(PART_SEPARATOR);
  if (english.length !== arabic.length) {
    fail(
      `row ${row.n}: ${english.length} English parts but ${arabic.length} Arabic parts`,
    );
  }
  return {english, arabic};
}

function placeholderNames(text) {
  return [...text.matchAll(CSV_PLACEHOLDER)].map(m => m[1]).sort();
}

function applyPlaceholders(text, map = {}, rowNumber) {
  return text.replace(CSV_PLACEHOLDER, (whole, name) => {
    if (!(name in map)) fail(`row ${rowNumber}: no specifier for {${name}}`);
    return map[name];
  });
}

/** The default English of each Android string the CSV may replace. */
function androidDefaults() {
  const strings = new Map();
  const files = [
    LIBRARY_STRINGS,
    path.join(APP_VALUES, 'strings.xml'),
    path.join(APP_VALUES, 'bayaan_widgets.xml'),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(
      /<string\s[^>]*name="([^"]+)"[^>]*>([^<]*)<\/string>/g,
    )) {
      // Later files (the app) replace the library, as Android merges them.
      strings.set(m[1], m[2].replace(/&amp;/g, '&').replace(/\\'/g, "'"));
    }
  }
  return strings;
}

function infoPlistString(key) {
  const src = readFileSync(INFO_PLIST, 'utf8');
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(
    src,
  );
  if (!m) fail(`${INFO_PLIST} has no ${key}`);
  return m[1];
}

/** "Prefix: a, b or c." → {prefix, items, end}. */
function parseList(text, separators, rowNumber) {
  const colon = text.indexOf(': ');
  if (colon < 0) fail(`row ${rowNumber}: "${text}" is not "Prefix: a or b."`);
  const prefix = text.slice(0, colon + 2);
  const end = text.endsWith('.') ? '.' : '';
  let body = text.slice(colon + 2, text.length - end.length);
  for (const sep of separators.slice(1))
    body = body.split(sep).join(separators[0]);
  return {prefix, items: body.split(separators[0]), end};
}

/**
 * Row 9: the CSV lists the Bayaan Now cards as "listening, occasions or
 * bedtime"; plugins/withBayaanWidgets.js lists only the cards that Qariah's
 * flags keep. Keep the Arabic items whose English items are still there.
 */
function filterList(row, englishPart, arabicPart, current) {
  const en = parseList(englishPart, [', ', ' or '], row.n);
  const ar = parseList(arabicPart, [' أو ', '، '], row.n);
  const now = parseList(current, [', ', ' or '], row.n);
  if (en.items.length !== ar.items.length || en.prefix !== now.prefix) {
    fail(`row ${row.n}: the list does not match "${current}"`);
  }
  const keep = now.items.map(item => {
    const index = en.items.indexOf(item);
    if (index < 0) fail(`row ${row.n}: "${item}" is not in the CSV English`);
    return ar.items[index];
  });
  return `${ar.prefix}${keep.join(' أو ')}${ar.end}`;
}

function build(rows, catalog) {
  const appName = rows.get(1)?.arabic;
  if (!appName) fail('row 1 (the app name) is missing');
  const android = androidDefaults();
  const outputs = {
    catalog: new Map(),
    android: new Map(),
    widget: new Map(),
    ios: new Map(),
  };
  const sources = new Map(); // "kind:key" -> row number
  const skipped = [];

  const put = (kind, key, value, rowNumber) => {
    const existing = outputs[kind].get(key);
    if (existing !== undefined && existing !== value) {
      fail(
        `rows ${sources.get(`${kind}:${key}`)} and ${rowNumber} give "${key}" different Arabic`,
      );
    }
    outputs[kind].set(key, value);
    if (!sources.has(`${kind}:${key}`))
      sources.set(`${kind}:${key}`, rowNumber);
  };

  for (const [n, specs] of Object.entries(ROWS)) {
    const row = rows.get(Number(n));
    if (!row) fail(`row ${n} is not in ${CSV_PATH}`);
    const parts = splitParts(row);
    for (const spec of specs) {
      const index = spec.part ?? 0;
      if (spec.part === undefined && parts.english.length !== 1) {
        fail(`row ${n} has ${parts.english.length} parts; name the part`);
      }
      const english = parts.english[index];
      const arabic = parts.arabic[index];
      if (english === undefined) fail(`row ${n} has no part ${index}`);
      if (spec.skip) {
        skipped.push(`row ${n} "${english}": ${spec.skip}`);
        continue;
      }

      const enNames = placeholderNames(english);
      let arNames = placeholderNames(arabic);
      if (
        spec.namesApp &&
        enNames.includes('app') &&
        !arNames.includes('app')
      ) {
        if (!arabic.includes(appName)) {
          fail(`row ${n}: the Arabic has neither {app} nor "${appName}"`);
        }
        arNames = [...arNames, 'app'].sort();
      }
      if (enNames.join() !== arNames.join()) {
        fail(`row ${n}: placeholders differ: "${english}" / "${arabic}"`);
      }
      const wrap = text =>
        spec.template ? spec.template.replace('{}', text) : text;
      const nativeEnglish = wrap(
        applyPlaceholders(english, spec.placeholders, n),
      );
      const nativeArabic = wrap(
        applyPlaceholders(arabic, spec.placeholders, n),
      );

      for (const key of spec.catalog ?? []) {
        const en = catalog.strings[key]?.localizations?.en?.stringUnit?.value;
        if (nativeEnglish !== key && nativeEnglish !== en) {
          fail(`row ${n}: "${nativeEnglish}" is not the catalog key "${key}"`);
        }
        put('catalog', key, nativeArabic, n);
      }
      for (const kind of ['android', 'widget']) {
        for (const name of spec[kind] ?? []) {
          const current = android.get(name);
          if (current === undefined)
            fail(`row ${n}: no Android string ${name}`);
          let value = nativeArabic;
          if (spec.list) {
            value = filterList(row, english, arabic, current);
          } else if (current !== nativeEnglish) {
            fail(
              `row ${n}: "${english}" is not the ${name} default "${current}"`,
            );
          }
          put(kind, name, value, n);
        }
      }
      for (const key of spec.ios ?? []) {
        const current = infoPlistString(key);
        if (current !== nativeEnglish) {
          fail(
            `row ${n}: "${english}" is not the Info.plist ${key} "${current}"`,
          );
        }
        put('ios', key, nativeArabic, n);
      }
    }
  }
  return {outputs, skipped};
}

function updateCatalog(catalog, arabic) {
  const strings = {};
  for (const [key, entry] of Object.entries(catalog.strings)) {
    const localizations = {...(entry.localizations ?? {})};
    delete localizations[LANGUAGE];
    // A generated entry with nothing left goes; its key fell out of the CSV.
    if (entry.comment === GENERATED_COMMENT && !arabic.has(key)) continue;
    strings[key] = {...entry, localizations};
  }
  for (const [key, value] of arabic) {
    strings[key] ??= {
      comment: GENERATED_COMMENT,
      extractionState: 'manual',
      localizations: {},
    };
    strings[key].localizations[LANGUAGE] = {
      stringUnit: {state: 'translated', value},
    };
  }
  return {...catalog, strings};
}

/** JSON the way Xcode writes a String Catalog: sorted keys, " : ". */
function xcodeJson(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map(v => `${inner}${xcodeJson(v, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries = keys.map(
    k => `${inner}${JSON.stringify(k)} : ${xcodeJson(value[k], inner)}`,
  );
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

const jsonFile = value => `${JSON.stringify(value, null, 2)}\n`;

function localeFile(outputs) {
  return jsonFile({
    ios: Object.fromEntries(outputs.ios),
    android: Object.fromEntries(outputs.android),
  });
}

function widgetFile(outputs) {
  return jsonFile({[LANGUAGE]: Object.fromEntries(outputs.widget)});
}

function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter(a => a !== '--check');
  if (unknown.length > 0) fail(`unknown argument ${unknown.join(' ')}`);
  const check = args.has('--check');

  const catalogSrc = readFileSync(CATALOG, 'utf8');
  const catalog = JSON.parse(catalogSrc);
  const {outputs, skipped} = build(readRows(), catalog);

  const files = [
    [CATALOG, `${xcodeJson(updateCatalog(catalog, outputs.catalog))}\n`],
    [LOCALE_FILE, localeFile(outputs)],
    [WIDGET_FILE, widgetFile(outputs)],
  ];
  const stale = [];
  for (const [file, content] of files) {
    let current = null;
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) continue;
    stale.push(path.relative(REPO_ROOT, file));
    if (!check) {
      mkdirSync(path.dirname(file), {recursive: true});
      writeFileSync(file, content);
    }
  }

  if (check) {
    if (stale.length > 0) {
      fail(
        `stale: ${stale.join(', ')}. Run node scripts/native-strings-from-review.mjs`,
      );
    }
    return;
  }
  console.log(
    `${outputs.catalog.size} catalog keys, ${outputs.ios.size} Info.plist keys, ` +
      `${outputs.android.size} app strings, ${outputs.widget.size} widget strings; ` +
      `${stale.length ? `wrote ${stale.join(', ')}` : 'no change'}`,
  );
  for (const line of skipped) console.log(`  not placed: ${line}`);
}

main();
