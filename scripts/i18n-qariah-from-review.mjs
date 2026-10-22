#!/usr/bin/env node
// @ai-generated
/**
 * Generates Qariah's i18n strings from the Arabic review pack
 * (planning/pass-c/arabic-review/ui-strings.csv). Nobody types the Arabic by
 * hand: a reviewer changes the CSV, and this script writes the JSON.
 *
 *   node scripts/i18n-qariah-from-review.mjs                       # A–P
 *   node scripts/i18n-qariah-from-review.mjs --check               # exit 1 if stale
 *   node scripts/i18n-qariah-from-review.mjs --section=U           # U (Task 6)
 *   node scripts/i18n-qariah-from-review.mjs --section=U --check
 *   node scripts/i18n-qariah-from-review.mjs --section=U --dry-run # print only
 *
 * Sections A–P: the `qariah:` keys go to i18n/locales/en/qariah.json (column
 * "English") and i18n/locales/ar/qariah.json (column "Reviewer: correction"
 * when it is filled, else "Suggested Arabic").
 *
 * The A–P output also holds two catalog sheets of the pack (Sprint 47 Task 8):
 *   - countries.csv → `qariah:countries.<ISO code>`, for example
 *     `countries.DZ` (the code is in the "Key" cell: "algeria (DZ)"; "XJ" is
 *     the synthetic code of data/countryISO.ts). i18n/qariahCatalog.ts maps
 *     the catalog `country` value to the code.
 *   - rewayat.csv section 2 (the rewayah names in the catalog) →
 *     `qariah:rewayat.<slug of the catalog name>`, but only for the rows that
 *     upstream does not cover. A row is covered when its Arabic equals an
 *     upstream `content:rewayah.long.*` value; the app then shows upstream's
 *     key (i18n/qariahCatalog.ts). Section 1 (the old Qariah glyph map) needs
 *     no output: data/rewayatArabic.ts reads upstream's
 *     `content:rewayat.people.*` now, and data/__tests__/ checks it against
 *     the sheet.
 *
 * Section U: the feminine Arabic forms of upstream keys go to
 * i18n/overrides/ar.json (the overlay in i18n/qariahOverrides.ts). Rows whose
 * Arabic says "(keep)" or "(keep upstream)" keep upstream's value. A row whose
 * Arabic says "See qariah:<key>" takes the generated value of that key.
 * Section Z needs no output: those rows reuse upstream keys as they are.
 *
 * The U output has three more parts that the CSV does not hold row by row
 * (Sprint 47 Task 6). Each is a rule in this file, and no Arabic is typed:
 *   - RENAMED_UPSTREAM_KEYS: a U row whose upstream key was renamed after the
 *     pack was drafted goes to the new key (same English, checked).
 *   - ENGLISH_OVERRIDE_TWINS: an upstream key whose English
 *     i18n/overrides/en.json restores to Qariah's wording takes the Arabic of
 *     the qariah key with that same wording (checked).
 *   - The app name (README decision 1): every upstream Arabic value with
 *     {{appName}} inside a sentence gets "تطبيق" before the name, so it reads
 *     "تطبيق قارئة" ("the Qariah app"), never "قارئة" alone ("a reciter").
 *     APP_NAME_BRAND_PLACES lists the brand labels that keep the name alone.
 *     i18n/qariahAppName.ts puts "قارئة" into {{appName}} at run time.
 *
 * How the CSV writes things, and what the script does with them:
 *   - The first line of "Key / where it appears" is the key. The file:line
 *     references after it are from before the Sprint 47 merge.
 *   - An English value that starts with "(new) " is a proposed string; the
 *     prefix is dropped.
 *   - English placeholders are written as in the code that had them:
 *     `${name}` and `{name}` become `{{name}}`, and `{n}` becomes `{{count}}`.
 *   - A plural Arabic cell has six lines, "zero: …" to "other: …". The
 *     English then gives one and other as "{n} item / {n} items" or
 *     "{n} item(s)". Rows that fit neither shape are in ENGLISH_FIXUPS below.
 *   - An Arabic plural line of "—" means "never shown" (for example zero
 *     skipped items); it takes the "other" line instead.
 *   - An Arabic cell of "—" marks a developer-only string: no key.
 *
 * The script fails when an Arabic value lacks a placeholder that its English
 * value has (or has one that the English lacks), when a plural cell is not
 * complete, or when two rows write the same key. Output is
 * `JSON.stringify(value, null, 2)` plus a newline, in CSV row order, so a
 * second run leaves the files byte-identical. i18n/__tests__/qariah.test.ts
 * runs `--check`.
 *
 * Plain Node (>= 18), no dependencies.
 */
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const REVIEW_DIR = path.join(REPO_ROOT, 'planning/pass-c/arabic-review');
const CSV_PATH = path.join(REVIEW_DIR, 'ui-strings.csv');
const COUNTRIES_CSV = path.join(REVIEW_DIR, 'countries.csv');
const REWAYAT_CSV = path.join(REVIEW_DIR, 'rewayat.csv');
const LOCALES = path.join(REPO_ROOT, 'i18n/locales');
const OUT_EN = path.join(LOCALES, 'en/qariah.json');
const OUT_AR = path.join(LOCALES, 'ar/qariah.json');
const OUT_AR_OVERRIDES = path.join(REPO_ROOT, 'i18n/overrides/ar.json');
const OUT_EN_OVERRIDES = path.join(REPO_ROOT, 'i18n/overrides/en.json');

const ARABIC_PLURALS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLACEHOLDER = /{{\s*([\w.]+)\s*}}/g;
const NOT_SHOWN = '—';

/**
 * English for the rows whose "English" cell is not a usable i18n string:
 * code templates with other placeholder names than the Arabic, plural rows
 * that are not "a / b" or "(s)", and cells that hold two strings. A fixup
 * gives the English only; the Arabic always comes from the CSV.
 *
 *   en:    the English value, or {one, other} for a plural row.
 *   split: one key per " / "-separated part of the cell; the Arabic cell is
 *          split the same way.
 */
const ENGLISH_FIXUPS = {
  'recent.minutesAgo': {en: {one: '{{count}}m ago', other: '{{count}}m ago'}},
  'recent.hoursAgo': {en: {one: '{{count}}h ago', other: '{{count}}h ago'}},
  'recent.daysAgo': {en: {one: '{{count}}d ago', other: '{{count}}d ago'}},
  'recent.weeksAgo': {en: {one: '{{count}}w ago', other: '{{count}}w ago'}},
  'browse.translationTitle': {en: '{{language}} translation'},
  'reciter.translationChip': {en: '{{language}} translation'},
  'reciter.recitations': {
    en: {one: '{{count}} recitation', other: '{{count}} recitations'},
  },
  'browse.recitersFound': {
    en: {
      one: '{{count}} reciter found with current filters',
      other: '{{count}} reciters found with current filters',
    },
  },
  'reflections.viewMoreA11y': {
    en: {
      one: 'View {{count}} more reflection on QuranReflect',
      other: 'View {{count}} more reflections on QuranReflect',
    },
  },
  'reflections.viewMore': {
    en: {
      one: 'View {{count}} more on QuranReflect',
      other: 'View {{count}} more on QuranReflect',
    },
  },
  'links.openFailedBody': {
    en: "Your device wasn't able to open {{destination}}. Please try again, or open it in your browser.",
  },
  // Two code fallbacks ("unknown error", "unknown") with one Arabic value.
  'data.unknownError': {en: 'Unknown error'},
  'data.importAdded': {en: '{{reciters}}, {{recitations}}, {{surahs}} added'},
  'v1.skippedNote': {
    en: {
      one: "Note: {{count}} recitation references a reciter that isn't available in the new app yet — it will be skipped.",
      other:
        "Note: {{count}} recitations reference a reciter that isn't available in the new app yet — these will be skipped.",
    },
  },
  'support.emailUsBody': {en: 'Please reach us at {{email}}'},
  // The Arabic names the app (قارئة, README decision 1) instead of a
  // placeholder, so the English names it too.
  'support.emailSubject': {
    split: [
      {key: 'support.emailSubjectSupport', en: 'Qariah support'},
      {
        key: 'support.emailSubjectFeatureRequest',
        en: 'Qariah feature request',
      },
    ],
  },
};

/**
 * Section U rows whose upstream key Bayaan renamed after the pack was drafted
 * (the pack was drafted against Bayaan #349). The new key must have the same
 * English as the CSV row; the script fails when it does not.
 */
const RENAMED_UPSTREAM_KEYS = {
  'sheets:favoriteReciters.searchPlaceholder':
    'sheets:reciterPicker.searchPlaceholder',
  'sheets:favoriteReciters.empty': 'sheets:reciterPicker.empty',
};

/**
 * Upstream keys whose English i18n/overrides/en.json replaces with Qariah's
 * wording. The Arabic follows the Qariah wording too: it is the generated
 * Arabic of the qariah key whose English is the same (the script fails when
 * the two English values differ).
 */
const ENGLISH_OVERRIDE_TWINS = {
  'home:home.exploreByRewayah': 'qariah:homeRows.rewayat',
  'settings:index.items.github.description': 'qariah:settings.githubDesc',
  'collection:notesScreen.emptySubtitle': 'qariah:notes.personalHint',
};

/** README decision 1: "تطبيق قارئة" ("the Qariah app") inside a sentence. */
const APP_WORD = 'تطبيق';

/**
 * Brand labels where the Arabic name stands alone (README decision 1), as in
 * the pack's own "دعم قارئة" (Qariah support). Every other upstream Arabic
 * value with {{appName}} gets APP_WORD before the name.
 */
const APP_NAME_BRAND_PLACES = new Set([
  'collection:systemPlaylist.curatedBadge', // the "Qariah Curated" badge
  'content:systemPlaylists.appEssentials.title', // "Qariah Essentials"
  'settings:credits.footer', // "Made with ❤️ by the Qariah team"
]);

function fail(message) {
  console.error(`i18n-qariah-from-review: ${message}`);
  process.exit(1);
}

/** RFC 4180: quoted cells may hold commas, doubled quotes and newlines. */
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

/**
 * The rows of one review-pack sheet. Every sheet has the same columns.
 * `keyCell` is the whole "Key / where it appears" cell; `arabic` is the
 * reviewer's correction when there is one, else the suggested Arabic.
 */
function readSheet(file) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const [header, ...data] = parseCsv(text);
  const column = name => {
    const index = header.indexOf(name);
    if (index < 0) fail(`${path.basename(file)} has no "${name}" column`);
    return index;
  };
  const cols = {
    number: column('#'),
    section: column('Section'),
    key: column('Key / where it appears (file:line)'),
    english: column('English'),
    arabic: column('Suggested Arabic'),
    correction: column('Reviewer: correction'),
  };
  return data
    .filter(cells => cells[cols.number]?.trim())
    .map(cells => {
      const correction = cells[cols.correction].trim();
      return {
        number: cells[cols.number].trim(),
        section: cells[cols.section].trim(),
        keyCell: cells[cols.key],
        english: cells[cols.english].trim(),
        arabic: correction || cells[cols.arabic].trim(),
      };
    });
}

function readRows() {
  return readSheet(CSV_PATH).map(({keyCell, section, ...row}) => ({
    ...row,
    section: section.split('.')[0].trim(),
    key: keyCell
      .split('\n')[0]
      .replace(/\s*\(NEW\)\s*$/, '')
      .trim(),
  }));
}

function placeholders(value) {
  return new Set([...value.matchAll(PLACEHOLDER)].map(match => match[1]));
}

/** `${name}` and `{name}` become `{{name}}`; `{n}` becomes `{{count}}`. */
function toI18nPlaceholders(value) {
  return value
    .replace(/\$\{(\w+)\}/g, '{{$1}}')
    .replace(/(?<!\{)\{(\w+)\}(?!\})/g, (_, name) =>
      name === 'n' ? '{{count}}' : `{{${name}}}`,
    );
}

/** The six lines of a plural Arabic cell, or null for a single value. */
function arabicPluralForms(row) {
  const lines = row.arabic.split('\n').map(line => line.trim());
  const forms = {};
  for (const line of lines) {
    const match = /^(zero|one|two|few|many|other):\s*(.*)$/.exec(line);
    if (!match) {
      if (Object.keys(forms).length > 0 || lines.length > 1) {
        fail(
          `row ${row.number} (${row.key}): unreadable plural line "${line}"`,
        );
      }
      return null;
    }
    forms[match[1]] = match[2].trim();
  }
  const missing = ARABIC_PLURALS.filter(c => !forms[c]);
  if (missing.length > 0) {
    fail(`row ${row.number} (${row.key}): no Arabic ${missing.join(', ')}`);
  }
  for (const category of ARABIC_PLURALS) {
    if (forms[category] === NOT_SHOWN) forms[category] = forms.other;
  }
  return Object.fromEntries(ARABIC_PLURALS.map(c => [c, forms[c]]));
}

/** {one, other} from "{n} item / {n} items" or "{n} item(s)". */
function englishPluralForms(row, english) {
  const parts = english.split(' / ');
  if (parts.length === 2) return {one: parts[0], other: parts[1]};
  if (english.includes('(s)')) {
    return {
      one: english.replaceAll('(s)', ''),
      other: english.replaceAll('(s)', 's'),
    };
  }
  fail(`row ${row.number} (${row.key}): plural English needs a fixup`);
  return null;
}

/** English and Arabic values for one key, checked against each other. */
function checkPlaceholders(row, key, english, arabic) {
  const plural = typeof english !== 'string';
  const englishValues = plural ? Object.values(english) : [english];
  const arabicValues = plural ? Object.values(arabic) : [arabic];
  const ignore = name => plural && name === 'count';
  const wanted = new Set(
    englishValues.flatMap(v => [...placeholders(v)]).filter(n => !ignore(n)),
  );
  for (const value of [...englishValues, ...arabicValues]) {
    if (/\$\{|(?<!\{)\{\w+\}(?!\})/.test(value)) {
      fail(`row ${row.number} (${key}): unconverted placeholder in "${value}"`);
    }
  }
  for (const value of arabicValues) {
    const found = placeholders(value);
    for (const name of wanted) {
      if (!found.has(name)) {
        fail(`row ${row.number} (${key}): Arabic "${value}" lacks {{${name}}}`);
      }
    }
    for (const name of found) {
      if (!ignore(name) && !wanted.has(name)) {
        fail(`row ${row.number} (${key}): Arabic has {{${name}}}, English not`);
      }
    }
  }
}

/** Sets `value` at a dotted path; plural values become `<leaf>_<form>`. */
function setPath(tree, key, value, rowNumber) {
  const parts = key.split('.');
  const leaf = parts.pop();
  let node = tree;
  for (const part of parts) {
    if (typeof node[part] === 'string') {
      fail(`row ${rowNumber}: "${key}" sits under the string key "${part}"`);
    }
    node[part] ??= {};
    node = node[part];
  }
  const entries =
    typeof value === 'string'
      ? [[leaf, value]]
      : Object.entries(value).map(([form, text]) => [`${leaf}_${form}`, text]);
  for (const [name, text] of entries) {
    if (name in node) fail(`row ${rowNumber}: "${key}" is written twice`);
    node[name] = text;
  }
}

/** Sections A–P → the `qariah` namespace. */
function buildQariahNamespace(rows) {
  const en = {};
  const ar = {};
  const skipped = [];
  for (const row of rows) {
    if (!/^[A-P]$/.test(row.section)) continue;
    const [ns, key] = row.key.split(':');
    if (ns !== 'qariah' || !key) {
      fail(`row ${row.number}: "${row.key}" is not a qariah: key`);
    }
    if (row.arabic === NOT_SHOWN) {
      skipped.push(`${row.key} (row ${row.number}): developer-only text`);
      continue;
    }
    const fixup = ENGLISH_FIXUPS[key];
    const english = toI18nPlaceholders(row.english.replace(/^\(new\)\s+/, ''));

    const entries = [];
    if (fixup?.split) {
      const arabicParts = row.arabic.split(' / ');
      if (arabicParts.length !== fixup.split.length) {
        fail(`row ${row.number} (${key}): the Arabic has no matching split`);
      }
      fixup.split.forEach((part, i) =>
        entries.push([part.key, part.en, arabicParts[i].trim()]),
      );
    } else {
      const arabicForms = arabicPluralForms(row);
      let englishValue = fixup?.en ?? english;
      if (arabicForms && typeof englishValue === 'string') {
        englishValue = englishPluralForms(row, englishValue);
      }
      if (!arabicForms && typeof englishValue !== 'string') {
        fail(`row ${row.number} (${key}): plural English, single Arabic`);
      }
      if (!fixup && !arabicForms && english.includes(' / ')) {
        fail(`row ${row.number} (${key}): two English strings need a fixup`);
      }
      entries.push([key, englishValue, arabicForms ?? row.arabic]);
    }

    for (const [entryKey, englishValue, arabicValue] of entries) {
      checkPlaceholders(row, entryKey, englishValue, arabicValue);
      setPath(en, entryKey, englishValue, row.number);
      setPath(ar, entryKey, arabicValue, row.number);
    }
  }
  return {en, ar, skipped};
}

function flatten(tree, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(tree)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[keyPath] = value;
    else Object.assign(out, flatten(value, keyPath));
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Flattened upstream locale file, read once per language and namespace. */
const upstreamCache = new Map();
function upstreamFlat(language, ns) {
  const id = `${language}/${ns}`;
  if (!upstreamCache.has(id)) {
    upstreamCache.set(
      id,
      flatten(readJson(path.join(LOCALES, language, `${ns}.json`))),
    );
  }
  return upstreamCache.get(id);
}

/** The upstream namespaces: every locale file except qariah.json. */
function upstreamNamespaces() {
  return readdirSync(path.join(LOCALES, 'ar'))
    .filter(file => file.endsWith('.json') && file !== 'qariah.json')
    .map(file => file.slice(0, -'.json'.length));
}

/** The generated Arabic of a qariah key: a string, or six plural forms. */
function qariahArabic(qariahFlat, key) {
  const forms = Object.fromEntries(
    ARABIC_PLURALS.map(c => [c, qariahFlat[`${key}_${c}`]]),
  );
  return forms.other ? forms : qariahFlat[key];
}

/** Writes `value` at a dotted path, replacing a value that is there. */
function replacePath(tree, key, value) {
  const parts = key.split('.');
  const leaf = parts.pop();
  let node = tree;
  for (const part of parts) {
    node[part] ??= {};
    node = node[part];
  }
  node[leaf] = value;
}

/**
 * README decision 1: puts APP_WORD before each {{appName}} that does not
 * already follow it. Upstream writes "لـ {{appName}}" (the prefix before a
 * Latin name); that becomes "لتطبيق {{appName}}".
 */
function withAppWord(value) {
  const name = /(?:<brand>)?\{\{appName\}\}/g;
  const joined = value.replace(
    /لـ ?(?=(?:<brand>)?\{\{appName\}\})/g,
    `ل${APP_WORD} `,
  );
  return joined.replace(name, (match, offset, whole) =>
    whole.slice(0, offset).endsWith(`${APP_WORD} `)
      ? match
      : `${APP_WORD} ${match}`,
  );
}

/** Section U → Arabic overrides of upstream keys (Task 6). */
function buildArabicOverrides(rows, qariahAr, qariahEn) {
  const overrides = {};
  const skipped = [];
  const notes = [];
  const qariahFlat = flatten(qariahAr);
  for (const row of rows) {
    if (row.section !== 'U') continue;
    if (/\(keep( upstream)?\)/.test(row.arabic)) {
      skipped.push(`${row.key} (row ${row.number}): keeps upstream`);
      continue;
    }
    const renamed = RENAMED_UPSTREAM_KEYS[row.key];
    const [ns, key] = (renamed ?? row.key).split(':');
    if (!ns || !key || key.includes(' ')) {
      fail(`row ${row.number}: "${row.key}" is not one upstream key`);
    }
    const upstreamFile = path.join(LOCALES, 'ar', `${ns}.json`);
    if (ns === 'qariah' || !existsSync(upstreamFile)) {
      fail(`row ${row.number}: "${ns}" is not an upstream namespace`);
    }
    const upstreamAr = upstreamFlat('ar', ns);
    const upstreamEn = upstreamFlat('en', ns);

    let arabic;
    const reference = /^See qariah:([\w.]+)/.exec(row.arabic);
    if (reference) {
      arabic = qariahArabic(qariahFlat, reference[1]);
      if (!arabic) fail(`row ${row.number}: no qariah:${reference[1]}`);
    } else {
      arabic = arabicPluralForms(row) ?? row.arabic;
    }

    const plural = typeof arabic !== 'string';
    const english = plural ? upstreamEn[`${key}_other`] : upstreamEn[key];
    const emitted = plural ? ARABIC_PLURALS.map(c => `${key}_${c}`) : [key];
    // The pack was drafted against an older upstream; a key that upstream
    // has since renamed or removed is reported, not guessed.
    const absent = emitted.filter(name => !(name in upstreamAr));
    if (english === undefined || absent.length > 0) {
      skipped.push(
        `${row.key} (row ${row.number}): NOT PLACED, upstream has no such key`,
      );
      continue;
    }
    if (renamed) {
      if (english !== row.english) {
        fail(
          `row ${row.number}: ${renamed} says "${english}", the pack "${row.english}"`,
        );
      }
      notes.push(`${row.key} (row ${row.number}) → ${renamed}`);
    }
    checkPlaceholders(
      row,
      row.key,
      plural ? {one: english, other: english} : english,
      arabic,
    );
    overrides[ns] ??= {};
    setPath(overrides[ns], key, arabic, row.number);
  }

  // English restorations (i18n/overrides/en.json) take the Arabic of the
  // qariah key with the same English.
  const englishOverrides = flatten(readJson(OUT_EN_OVERRIDES));
  const qariahEnFlat = flatten(qariahEn);
  for (const [upstreamKey, qariahKey] of Object.entries(
    ENGLISH_OVERRIDE_TWINS,
  )) {
    const [ns, key] = upstreamKey.split(':');
    const twinKey = qariahKey.slice('qariah:'.length);
    const englishOverride = englishOverrides[`${ns}.${key}`];
    if (englishOverride === undefined) {
      fail(
        `${upstreamKey} is not in ${path.relative(REPO_ROOT, OUT_EN_OVERRIDES)}`,
      );
    }
    if (englishOverride !== qariahEnFlat[twinKey]) {
      fail(
        `${upstreamKey} says "${englishOverride}" in English, ${qariahKey} "${qariahEnFlat[twinKey]}"`,
      );
    }
    if (flatten(overrides[ns] ?? {})[key] !== undefined) {
      fail(`${upstreamKey} has a section U row and a twin`);
    }
    const arabic = qariahArabic(qariahFlat, twinKey);
    if (typeof arabic !== 'string' || !(key in upstreamFlat('ar', ns))) {
      fail(`${upstreamKey}: the twin must be one string upstream has`);
    }
    checkPlaceholders(
      {number: `twin ${qariahKey}`},
      upstreamKey,
      upstreamFlat('en', ns)[key],
      arabic,
    );
    overrides[ns] ??= {};
    setPath(overrides[ns], key, arabic, `twin ${qariahKey}`);
    notes.push(`${upstreamKey} ← ${qariahKey} (English override twin)`);
  }

  // README decision 1: "تطبيق قارئة" inside a sentence.
  for (const ns of upstreamNamespaces()) {
    const current = flatten(overrides[ns] ?? {});
    for (const [key, upstreamValue] of Object.entries(upstreamFlat('ar', ns))) {
      const value = current[key] ?? upstreamValue;
      if (!value.includes('{{appName}}')) continue;
      if (APP_NAME_BRAND_PLACES.has(`${ns}:${key}`)) continue;
      const next = withAppWord(value);
      if (next === value) continue;
      overrides[ns] ??= {};
      replacePath(overrides[ns], key, next);
      notes.push(`${ns}:${key}: app name inside a sentence`);
    }
  }
  return {overrides, skipped, notes};
}

/**
 * The i18n key of a catalog rewayah name: "Al-Kisa'i" → "al-kisai",
 * "Hafs 'an 'Āṣim" → "hafs-an-asim". i18n/qariahCatalog.ts has the same
 * function; the two must stay the same.
 */
function rewayahSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’ʼ‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** countries.csv → `countries.<ISO code>` in both languages. */
function addCountries(en, ar) {
  const notes = [];
  for (const row of readSheet(COUNTRIES_CSV)) {
    const match = /^([a-z-]+) \(([A-Z]{2})\)$/.exec(
      row.keyCell.split('\n')[0].trim(),
    );
    if (!match) fail(`countries.csv row ${row.number}: no "slug (CODE)" key`);
    if (!row.english || !row.arabic) {
      fail(`countries.csv row ${row.number}: empty English or Arabic`);
    }
    const key = `countries.${match[2]}`;
    setPath(en, key, row.english, `countries ${row.number}`);
    setPath(ar, key, row.arabic, `countries ${row.number}`);
  }
  notes.push(`countries.csv → ${Object.keys(en.countries).length} keys`);
  return notes;
}

/**
 * rewayat.csv section 2 → `rewayat.<slug>` for the catalog rewayah names
 * that upstream's `content:rewayah.long.*` Arabic does not cover.
 */
function addCatalogRewayat(en, ar) {
  const notes = [];
  const upstreamLong = new Map(
    Object.entries(upstreamFlat('ar', 'content'))
      .filter(([key]) => key.startsWith('rewayah.long.'))
      .map(([key, value]) => [value, key]),
  );
  for (const row of readSheet(REWAYAT_CSV)) {
    if (!row.section.startsWith('2.')) continue;
    const name = /^catalog rewayat\[\]\.name = "(.+)"$/.exec(
      row.keyCell.split('\n')[0].trim(),
    )?.[1];
    if (!name) fail(`rewayat.csv row ${row.number}: no catalog name in key`);
    if (name !== row.english) {
      fail(
        `rewayat.csv row ${row.number}: key "${name}", English "${row.english}"`,
      );
    }
    if (!row.arabic) fail(`rewayat.csv row ${row.number}: empty Arabic`);
    const upstreamKey = upstreamLong.get(row.arabic);
    if (upstreamKey) {
      notes.push(`"${name}" (row ${row.number}) → content:${upstreamKey}`);
      continue;
    }
    const slug = rewayahSlug(name);
    if (!slug) fail(`rewayat.csv row ${row.number}: empty slug`);
    setPath(en, `rewayat.${slug}`, name, `rewayat ${row.number}`);
    setPath(ar, `rewayat.${slug}`, row.arabic, `rewayat ${row.number}`);
    notes.push(`"${name}" (row ${row.number}) → qariah:rewayat.${slug}`);
  }
  return notes;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dryRun = args.includes('--dry-run');
  const section =
    args.find(a => a.startsWith('--section='))?.slice('--section='.length) ??
    'A-P';
  if (section !== 'A-P' && section !== 'U') {
    fail(`unknown --section=${section} (use A-P or U)`);
  }

  const rows = readRows();
  const qariah = buildQariahNamespace(rows);
  const outputs = [];
  let skipped = qariah.skipped;
  let notes = [];
  if (section === 'A-P') {
    notes = [
      ...addCountries(qariah.en, qariah.ar),
      ...addCatalogRewayat(qariah.en, qariah.ar),
    ];
    outputs.push(
      [OUT_EN, serialize(qariah.en)],
      [OUT_AR, serialize(qariah.ar)],
    );
  } else {
    const result = buildArabicOverrides(rows, qariah.ar, qariah.en);
    outputs.push([OUT_AR_OVERRIDES, serialize(result.overrides)]);
    skipped = result.skipped;
    notes = result.notes;
  }

  const relative = file => path.relative(REPO_ROOT, file);
  if (dryRun) {
    for (const [file, text] of outputs) {
      console.log(`--- ${relative(file)}\n${text}`);
    }
  } else if (check) {
    const stale = outputs.filter(
      ([file, text]) =>
        !existsSync(file) || readFileSync(file, 'utf8') !== text,
    );
    if (stale.length > 0) {
      fail(
        `stale: ${stale.map(([file]) => relative(file)).join(', ')}. ` +
          `Run: node scripts/i18n-qariah-from-review.mjs` +
          (section === 'U' ? ' --section=U' : ''),
      );
    }
  } else {
    for (const [file, text] of outputs) writeFileSync(file, text);
  }

  const counts = outputs
    .map(([file, text]) => {
      const keys = Object.keys(flatten(JSON.parse(text))).length;
      return `${relative(file)}: ${keys} keys`;
    })
    .join('; ');
  console.log(
    `${check ? 'up to date' : dryRun ? 'dry run' : 'wrote'}: ${counts}`,
  );
  for (const line of skipped) console.log(`  skipped ${line}`);
  for (const line of notes) console.log(`  placed ${line}`);
}

main();
