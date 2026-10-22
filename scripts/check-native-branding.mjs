#!/usr/bin/env node
// @ai Qariah (Sprint 46, Pass B story B4) — user-visible brand text in the
// upstream native modules.
//
// scripts/check-branding.sh scans .ts/.tsx/.js/.jsx only, and it allowlists
// the upstream module paths (modules/bayaan-*, services/car/, services/widgets/,
// the widget and car plugins) because their identifiers carry the upstream
// name (BayaanCar, BayaanWidgets, BayaanNow ...). This check reads the string
// literals and the resource text in those places, and fails on the WORD
// "Bayaan" in text that a user can see:
//   - .swift, .kt, .ts/.tsx/.js: string literals, outside comments and log
//     calls;
//   - .xml, .plist: element text (not a plist <key>) and the user-visible
//     attributes (android:label, android:description ...);
//   - .xcstrings: the localized values (the keys are source text);
//   - .strings: the values.
// "Bayaan" inside a longer identifier (BayaanCar, bayaan_widget_now_label) is
// not a hit. Test files are not scanned (they do not ship).
//
// Exempt, and verified where a file can prove it:
//   - FALLBACKS: the literal "Bayaan" in the files that use it only when the
//     app name cannot be read at runtime (RFC-021).
//   - CATALOG_OVERRIDES: Swift source strings that a String Catalog in the
//     same target replaces. The check reads the catalog and fails when the
//     override is missing or still says "Bayaan".
//   - An Android library <string> that the app's resource of the same name
//     (android/app/src/main/res/values*/) replaces with Qariah text.
//
// Usage: node scripts/check-native-branding.mjs [repo-root]
// Exit 0 = clean, 1 = user-visible brand text found.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const BRAND_WORD = /(^|[^A-Za-z0-9_.])Bayaan(?![A-Za-z0-9_])/;

/** Native trees to scan. */
const NATIVE_ROOTS = ['modules', 'targets'];
const NATIVE_EXTENSIONS = [
  '.swift',
  '.kt',
  '.xml',
  '.plist',
  '.xcstrings',
  '.strings',
];

/** JS/TS paths that check-branding.sh allowlists for their identifiers. */
const JS_PATHS = [
  /^modules\/bayaan-[^/]+\//,
  /^services\/car\//,
  /^services\/widgets\//,
  /^plugins\/with(BayaanCar|AppShortcuts|BayaanWidgets)\.js$/,
  /^targets\/.*\.js$/,
];
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  '.gradle',
  '.cxx',
  'Pods',
  '.git',
]);
const TEST_PATH =
  /(\/__tests__\/|\/src\/test\/|\/src\/androidTest\/|\.test\.[jt]sx?$|Tests?\.(swift|kt)$)/;

/** The literal "Bayaan", used only when the app name cannot be read. */
const FALLBACKS = new Map([
  ['targets/widgets/_shared/AppIdentity.swift', ['Bayaan']],
  ['modules/bayaan-car/ios/CarBrand.swift', ['Bayaan']],
  [
    'modules/bayaan-car/android/src/main/java/expo/modules/bayaancar/CarBrand.kt',
    ['Bayaan'],
  ],
  [
    'modules/bayaan-widgets/android/src/main/java/expo/modules/bayaanwidgets/AppBrand.kt',
    ['Bayaan'],
  ],
  ['plugins/withBayaanWidgets.js', ['Bayaan']],
]);

/** Swift source strings that a String Catalog replaces (Sprint 46, B3). */
const CATALOG_OVERRIDES = new Map([
  [
    'targets/widgets/_shared/PlaybackIntents.swift',
    {
      catalog: 'targets/widgets/_shared/Localizable.xcstrings',
      strings: [
        'Plays a surah in Bayaan with your default reciter.',
        'Pauses the recitation playing in Bayaan.',
        'Resumes your recitation in Bayaan, or plays your most recent surah.',
        'Play or Pause Bayaan',
      ],
    },
  ],
]);

/** XML attributes whose value a user can see. */
const VISIBLE_ATTRIBUTES = new Set([
  'label',
  'description',
  'title',
  'text',
  'contentDescription',
  'hint',
  'summary',
  'shortLabel',
  'longLabel',
  'disabledMessage',
  'tooltipText',
]);

/** A call whose string argument goes to a log, not to a screen. */
const LOG_CALL =
  /\b(NSLog|os_log|print|debugPrint|Log\.[vdiwe]|console\.(log|warn|error|info|debug))\s*\(/;

function repoRoot() {
  if (process.argv[2]) return process.argv[2];
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return process.cwd();
  }
}

function walk(root, dir, files) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(root, rel, files);
    else files.push(rel);
  }
}

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

/**
 * The string literals of a Swift, Kotlin or JS/TS source, outside comments,
 * with the line where each one starts. Interpolations are skipped, and a
 * simple quoted string inside one is skipped with it.
 */
function stringLiterals(src, lang) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let prev = ''; // the last significant character (JS regex heuristic)

  const advance = () => {
    if (src[i] === '\n') line++;
    i++;
  };

  // Skip an interpolation that starts at src[i] (after `\(` or `${`).
  const skipInterpolation = (open, close) => {
    let depth = 1;
    while (i < n && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        advance();
        while (i < n && src[i] !== quote) {
          if (src[i] === '\\') advance();
          advance();
        }
        advance();
        continue;
      }
      if (c === open) depth++;
      else if (c === close) depth--;
      advance();
    }
  };

  const readString = (quote, triple) => {
    const start = line;
    let text = '';
    i += triple ? 3 : 1;
    while (i < n) {
      if (triple && src.startsWith(quote.repeat(3), i)) {
        i += 3;
        break;
      }
      const c = src[i];
      if (!triple && c === quote) {
        i++;
        break;
      }
      if (!triple && c === '\n' && quote !== '`') break; // unterminated
      if (c === '\\') {
        if (lang === 'swift' && src[i + 1] === '(') {
          i += 2;
          skipInterpolation('(', ')');
          text += ' ';
          continue;
        }
        if (src[i + 1] === '\n') line++;
        text += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (
        c === '$' &&
        src[i + 1] === '{' &&
        (lang === 'kotlin' || quote === '`')
      ) {
        i += 2;
        skipInterpolation('{', '}');
        text += ' ';
        continue;
      }
      text += c;
      advance();
    }
    out.push({text, line: start});
    prev = quote;
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) advance();
      i += 2;
      continue;
    }
    if (c === '"') {
      readString('"', lang !== 'js' && src.startsWith('"""', i));
      continue;
    }
    if (lang === 'js' && (c === "'" || c === '`')) {
      readString(c, false);
      continue;
    }
    if (lang === 'kotlin' && c === "'") {
      // A char literal, such as '"' or '\n'.
      i++;
      while (i < n && src[i] !== "'" && src[i] !== '\n')
        i += src[i] === '\\' ? 2 : 1;
      i++;
      prev = "'";
      continue;
    }
    if (
      lang === 'js' &&
      c === '/' &&
      (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))
    ) {
      // A regex literal.
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const r = src[i];
        if (r === '/' && !inClass) break;
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        i += r === '\\' ? 2 : 1;
      }
      i++;
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    advance();
  }
  return out;
}

function catalogValues(catalogSrc) {
  const values = new Map(); // key -> [values]
  const data = JSON.parse(catalogSrc);
  const collect = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if (node.stringUnit && typeof node.stringUnit.value === 'string') {
      acc.push(node.stringUnit.value);
    }
    for (const child of Object.values(node)) collect(child, acc);
  };
  for (const [key, entry] of Object.entries(data.strings ?? {})) {
    const acc = [];
    collect(entry.localizations, acc);
    values.set(key, acc);
  }
  return values;
}

function androidAppStrings(root, qualifier) {
  const dir = join(root, 'android', 'app', 'src', 'main', 'res', qualifier);
  const strings = new Map();
  if (!existsSync(dir)) return strings;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.xml')) continue;
    const src = readFileSync(join(dir, name), 'utf8');
    for (const m of src.matchAll(
      /<string\s[^>]*name="([^"]+)"[^>]*>([^<]*)<\/string>/g,
    )) {
      strings.set(m[1], m[2]);
    }
  }
  return strings;
}

function main() {
  const root = repoRoot();
  const files = [];
  for (const dir of [...NATIVE_ROOTS, 'services', 'plugins'])
    walk(root, dir, files);

  const findings = [];
  const report = (file, line, text, why) =>
    findings.push(`${file}:${line}: "${text}" — ${why}`);
  const catalogs = new Map();

  for (const file of files) {
    if (TEST_PATH.test(file)) continue;
    const ext = extension(file);
    const isNative =
      NATIVE_ROOTS.some(r => file.startsWith(`${r}/`)) &&
      NATIVE_EXTENSIONS.includes(ext);
    const isJs =
      JS_EXTENSIONS.includes(ext) && JS_PATHS.some(p => p.test(file));
    if (!isNative && !isJs) continue;
    const src = readFileSync(join(root, file), 'utf8');
    if (!src.includes('Bayaan')) continue;
    const lines = src.split('\n');

    if (ext === '.swift' || ext === '.kt' || isJs) {
      const lang = ext === '.swift' ? 'swift' : ext === '.kt' ? 'kotlin' : 'js';
      for (const {text, line} of stringLiterals(src, lang)) {
        if (!BRAND_WORD.test(text)) continue;
        if (LOG_CALL.test(lines[line - 1] ?? '')) continue;
        if ((FALLBACKS.get(file) ?? []).includes(text)) continue;
        const override = CATALOG_OVERRIDES.get(file);
        if (override && override.strings.includes(text)) {
          if (!catalogs.has(override.catalog)) {
            const path = join(root, override.catalog);
            catalogs.set(
              override.catalog,
              existsSync(path)
                ? catalogValues(readFileSync(path, 'utf8'))
                : new Map(),
            );
          }
          const values = catalogs.get(override.catalog).get(text) ?? [];
          if (values.length > 0 && values.every(v => !BRAND_WORD.test(v)))
            continue;
          report(file, line, text, `not replaced in ${override.catalog}`);
          continue;
        }
        report(file, line, text, 'user-visible string literal');
      }
      continue;
    }

    if (ext === '.xml' || ext === '.plist') {
      const clean = src.replace(/<!--[\s\S]*?-->/g, m =>
        m.replace(/[^\n]/g, ' '),
      );
      for (const m of clean.matchAll(
        /<([A-Za-z_][\w:.-]*)((?:\s[^>]*?)?)>([^<]*)</g,
      )) {
        const [, tag, attrs, text] = m;
        if (!BRAND_WORD.test(text) || tag === 'key') continue;
        const line = lineAt(clean, m.index + m[0].length - text.length - 1);
        const name = /\bname="([^"]+)"/.exec(attrs)?.[1];
        const qualifier = file.split('/').at(-2) ?? '';
        if (tag === 'string' && name && qualifier.startsWith('values')) {
          const app = androidAppStrings(root, qualifier).get(name);
          if (app !== undefined && !BRAND_WORD.test(app)) continue;
          report(
            file,
            line,
            text.trim(),
            `no Qariah override of <string name="${name}"> in android/app/src/main/res/${qualifier}/`,
          );
          continue;
        }
        report(file, line, text.trim(), `user-visible <${tag}> text`);
      }
      for (const tag of clean.matchAll(/<[A-Za-z_][^>]*>/g)) {
        for (const a of tag[0].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
          const local = a[1].split(':').at(-1);
          if (
            !VISIBLE_ATTRIBUTES.has(local) ||
            !BRAND_WORD.test(a[2]) ||
            a[2].startsWith('@')
          )
            continue;
          report(
            file,
            lineAt(clean, tag.index + a.index),
            a[2],
            `user-visible ${a[1]}`,
          );
        }
      }
      continue;
    }

    if (ext === '.xcstrings') {
      for (const [key, values] of catalogValues(src)) {
        for (const value of values) {
          if (!BRAND_WORD.test(value)) continue;
          const quoted = JSON.stringify(value).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
          );
          const at =
            new RegExp(`"value"\\s*:\\s*${quoted}`).exec(src)?.index ?? 0;
          report(file, lineAt(src, at), value, `localized value of "${key}"`);
        }
      }
      continue;
    }

    if (ext === '.strings') {
      for (const m of src.matchAll(
        /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm,
      )) {
        if (BRAND_WORD.test(m[2]))
          report(file, lineAt(src, m.index), m[2], `value of "${m[1]}"`);
      }
    }
  }

  if (findings.length > 0) {
    console.error('User-visible "Bayaan" text in native or module code:');
    for (const f of findings) console.error(`  ${f}`);
    console.error(
      'Read the name from the app at runtime, override the text through an RFC-021 seam (a String Catalog, an app resource), or add a documented fallback to scripts/check-native-branding.mjs.',
    );
    process.exit(1);
  }
  console.log('✓ No user-visible "Bayaan" text in native or module code.');
}

main();
