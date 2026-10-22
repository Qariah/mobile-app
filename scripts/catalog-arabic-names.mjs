#!/usr/bin/env node
// @ai-start
/**
 * Adds the Arabic reciter text from the Pass C review pack to a catalog
 * (Sprint 47 Task 8). The owner accepted the pack as the Arabic baseline on
 * 2026-10-18 (planning/pass-c/arabic-review/README.md).
 *
 *   name_arabic  from reciter-names.csv, matched by the reciter id in the
 *                "Key" cell ("id: <uuid>"). Upstream Bayaan's field:
 *                `getReciterDisplayName` (i18n/format.ts) shows it in Arabic.
 *   bio_ar       from reciter-bios.csv, matched by the slug in the "Key" cell
 *                ("slug: <slug>"). A Qariah field: the reciter header shows it
 *                in Arabic instead of `bio_en` (i18n/qariahCatalog.ts).
 *
 * A reviewer correction (column "Reviewer: correction") wins over
 * "Suggested Arabic". A bio is written only when the sheet's English is the
 * reciter's `bio_en`; when the catalog bio changed after the review, the
 * Arabic would be wrong, so the script reports the reciter and writes
 * nothing for it. A name is written by id even when the English name
 * changed (a spelling fix keeps the person); the script reports the change.
 * The script never removes a field. `name_arabic` goes right after `name`
 * and `bio_ar` right after `bio_en`, so a catalog diff shows only the added
 * lines.
 *
 * Two uses:
 *   1. A catalog file (the bundled assets/data/catalog.json):
 *        node scripts/catalog-arabic-names.mjs --in=assets/data/catalog.json
 *        node scripts/catalog-arabic-names.mjs --in=<file> --write
 *        node scripts/catalog-arabic-names.mjs --in=<file> --check  # exit 1 if stale
 *   2. The transform of scripts/catalog-r2-mutate.mjs (the live R2 catalog):
 *        node scripts/catalog-r2-mutate.mjs --transform=scripts/catalog-arabic-names.mjs
 *
 * The CSVs are read relative to this file, so the script works from any
 * directory. Plain Node (>= 18), no dependencies.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const REVIEW_DIR = path.join(REPO_ROOT, 'planning/pass-c/arabic-review');
const NAMES_CSV = 'reciter-names.csv';
const BIOS_CSV = 'reciter-bios.csv';

/** The only reciter fields that this transform writes. */
export const ALLOWED_FIELDS = ['name_arabic', 'bio_ar'];

/**
 * RFC 4180 CSV: a byte-order mark, CRLF or LF row ends, and quoted cells
 * with commas, doubled quotes and newlines. Rows with only empty cells are
 * dropped.
 */
export function parseCsv(text) {
  const s = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
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
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted cell');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

/** Rows of a review-pack sheet: {number, key, english, arabic}. */
export function readSheetText(text, sheet = 'sheet') {
  const [header, ...data] = parseCsv(text);
  const column = name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${sheet}: no column "${name}"`);
    return index;
  };
  const cols = {
    number: column('#'),
    key: column('Key / where it appears (file:line)'),
    english: column('English'),
    suggested: column('Suggested Arabic'),
    correction: column('Reviewer: correction'),
  };
  return data.map(cells => ({
    number: (cells[cols.number] ?? '').trim(),
    key: cells[cols.key] ?? '',
    english: (cells[cols.english] ?? '').trim(),
    arabic:
      (cells[cols.correction] ?? '').trim() ||
      (cells[cols.suggested] ?? '').trim(),
  }));
}

/** Rows keyed by one "<field>: <value>" line of the "Key" cell. */
function keyedRows(rows, field, pattern, sheet) {
  const map = new Map();
  for (const row of rows) {
    const value = new RegExp(`^${field}:\\s*(${pattern})\\s*$`, 'm').exec(
      row.key,
    )?.[1];
    if (!value) throw new Error(`${sheet} row ${row.number}: no "${field}:"`);
    if (!row.arabic) throw new Error(`${sheet} row ${row.number}: no Arabic`);
    if (map.has(value)) {
      throw new Error(`${sheet} row ${row.number}: ${field} ${value} twice`);
    }
    map.set(value, {arabic: row.arabic, english: row.english, row: row.number});
  }
  return map;
}

/** reciter-names.csv text → Map(id → {arabic, english, row}). */
export function parseNames(text) {
  return keyedRows(
    readSheetText(text, NAMES_CSV),
    'id',
    '[0-9a-f-]{36}',
    NAMES_CSV,
  );
}

/** reciter-bios.csv text → Map(slug → {arabic, english, row}). */
export function parseBios(text) {
  return keyedRows(readSheetText(text, BIOS_CSV), 'slug', '\\S+', BIOS_CSV);
}

export function loadReviewSheets(dir = REVIEW_DIR) {
  return {
    names: parseNames(readFileSync(path.join(dir, NAMES_CSV), 'utf8')),
    bios: parseBios(readFileSync(path.join(dir, BIOS_CSV), 'utf8')),
  };
}

/**
 * `object` with `key` set to `value`: in place when the key is there, else
 * right after `after` (at the end when `after` is missing).
 */
export function withFieldAfter(object, after, key, value) {
  if (key in object || !(after in object)) return {...object, [key]: value};
  const out = {};
  for (const [k, v] of Object.entries(object)) {
    out[k] = v;
    if (k === after) out[key] = value;
  }
  return out;
}

/**
 * Applies the sheets to a reciter list. Returns the new list (the input is
 * not changed) and a report of what was set and what was not.
 */
export function applyArabicText(reciters, sheets) {
  const report = {
    names: {set: 0, unchanged: 0, missing: [], renamed: []},
    bios: {set: 0, unchanged: 0, missing: [], stale: []},
    unusedNames: [],
    unusedBios: [],
  };
  const usedNames = new Set();
  const usedBios = new Set();
  const out = reciters.map(reciter => {
    let next = reciter;
    const label = `${reciter.slug || reciter.id} (${reciter.id})`;

    const name = sheets.names.get(reciter.id);
    if (!name) {
      report.names.missing.push(label);
    } else {
      usedNames.add(reciter.id);
      if (name.english !== reciter.name) {
        report.names.renamed.push(
          `${label}: catalog "${reciter.name}", sheet row ${name.row} "${name.english}"`,
        );
      }
      if (reciter.name_arabic === name.arabic) {
        report.names.unchanged++;
      } else {
        next = withFieldAfter(next, 'name', 'name_arabic', name.arabic);
        report.names.set++;
      }
    }

    const english = reciter.bio_en?.trim();
    const bio = reciter.slug ? sheets.bios.get(reciter.slug) : undefined;
    if (bio) usedBios.add(reciter.slug);
    if (english) {
      if (!bio) {
        report.bios.missing.push(label);
      } else if (bio.english !== english) {
        report.bios.stale.push(
          `${label}: catalog "${english}", sheet row ${bio.row} "${bio.english}"`,
        );
      } else if (reciter.bio_ar === bio.arabic) {
        report.bios.unchanged++;
      } else {
        next = withFieldAfter(next, 'bio_en', 'bio_ar', bio.arabic);
        report.bios.set++;
      }
    }
    return next;
  });
  for (const [id, {row}] of sheets.names) {
    if (!usedNames.has(id)) report.unusedNames.push(`row ${row} (${id})`);
  }
  for (const [slug, {row}] of sheets.bios) {
    if (!usedBios.has(slug)) report.unusedBios.push(`row ${row} (${slug})`);
  }
  return {reciters: out, report};
}

/** One line per finding, for a log or the R2 audit detail. */
export function formatReport(report) {
  const {names, bios} = report;
  const lines = [
    `name_arabic: ${names.set} set, ${names.unchanged} unchanged, ${names.missing.length} without a sheet row`,
    `bio_ar: ${bios.set} set, ${bios.unchanged} unchanged, ${bios.missing.length} without a sheet row, ${bios.stale.length} not written (English differs)`,
  ];
  const list = (title, items) =>
    items.length > 0 && lines.push(`  ${title}: ${items.join('; ')}`);
  list('no name', names.missing);
  list('name changed since the review (name written)', names.renamed);
  list('no bio row', bios.missing);
  list('bio changed since the review (bio NOT written)', bios.stale);
  list('name rows with no catalog reciter', report.unusedNames);
  list('bio rows with no catalog bio', report.unusedBios);
  return lines;
}

/** Transform entry point for scripts/catalog-r2-mutate.mjs. */
export default function transform(reciters) {
  const {reciters: out, report} = applyArabicText(reciters, loadReviewSheets());
  return {
    reciters: out,
    allowedFields: ALLOWED_FIELDS,
    summary: `Pass C Arabic (Sprint 47): ${formatReport(report).join(' | ')}`,
    report,
  };
}

/**
 * The text of `value` in the same JSON layout as `original` (2-space or
 * minified, with or without a final newline). Throws for any other layout,
 * so a write never reformats a file.
 */
export function serializeLike(original, value) {
  const parsed = JSON.parse(original);
  for (const [indent, newline] of [
    [2, '\n'],
    [2, ''],
    [0, '\n'],
    [0, ''],
  ]) {
    if (JSON.stringify(parsed, null, indent) + newline === original) {
      return JSON.stringify(value, null, indent) + newline;
    }
  }
  throw new Error('unknown JSON layout: not 2-space or minified');
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => a.startsWith('--in='))?.slice('--in='.length);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (!file || (write && check)) {
    console.error('Usage: --in=<catalog.json> [--write | --check]');
    process.exit(2);
  }
  const original = readFileSync(file, 'utf8');
  const parsed = JSON.parse(original);
  const list = Array.isArray(parsed) ? parsed : parsed.reciters;
  if (!Array.isArray(list)) {
    console.error(`${file}: not an array or {reciters: [...]}`);
    process.exit(1);
  }
  const {reciters, report} = applyArabicText(list, loadReviewSheets());
  for (const line of formatReport(report)) console.log(line);
  const next = serializeLike(
    original,
    Array.isArray(parsed) ? reciters : {...parsed, reciters},
  );
  if (check) {
    if (next !== original) {
      console.error(
        `${file} is stale. Run: node scripts/catalog-arabic-names.mjs --in=${file} --write`,
      );
      process.exit(1);
    }
    console.log(`${file} is up to date`);
  } else if (write) {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
  } else {
    console.log('(no file written; pass --write)');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
// @ai-end
