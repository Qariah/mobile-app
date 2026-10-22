/**
 * scripts/apply-reciter-metadata.ts
 *
 * Sprint 14 — supersedes `apply-sprint-13-curation.ts`.
 *
 * Reads the combined reciter-metadata CSV (Sprint 6 bios + Sprint 13
 * country/honored/paradise + Sprint 14 translation) and applies the
 * results to:
 *
 *   1. `assets/data/catalog.json` — writes per-reciter `country`, `bio_en`,
 *      and `translation` fields (matched by normalized name).
 *   2. `data/reciterCollections.ts` — replaces `HONORED_RECITER_NAMES`
 *      and `PARADISE_RECITER_NAMES` arrays + writes
 *      `TRANSLATION_RECITER_NAMES` Map (slug → translation tag).
 *
 * Idempotent: re-running with the same CSV is a no-op.
 *
 * CSV format (header on first non-comment line):
 *   slug,name,image_url,date,recitations_count,bio_en,country,paradise,honored,translation
 *
 * Usage: `npx tsx scripts/apply-reciter-metadata.ts [csv-path]`
 *   Default CSV path: ~/claude/qariah-v2-feedback/not-addressed/reciter-metadata - Sheet1.csv
 *   Override:        positional arg, OR set RECITER_METADATA_CSV env var.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CSV = path.join(REPO_ROOT, 'planning/reciter-metadata.csv');
const CSV_PATH =
  process.argv[2] ?? process.env.RECITER_METADATA_CSV ?? DEFAULT_CSV;
const CATALOG_PATH = path.join(REPO_ROOT, 'assets/data/catalog.json');
const COLLECTIONS_PATH = path.join(REPO_ROOT, 'data/reciterCollections.ts');

interface Row {
  slug: string;
  name: string;
  date: string;
  bio_en: string;
  country: string;
  honored: boolean;
  paradise: boolean;
  translation: string;
}

function parseBool(value: string): boolean {
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  let cur = '';
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      fields.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text: string): Row[] {
  // Drop comment lines (start with `#` or `"#`) and empty lines.
  const lines = text.split('\n').filter(l => {
    const trimmed = l.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('"#')) return false;
    return true;
  });
  const [header, ...body] = lines;
  if (!header) throw new Error('CSV is empty');
  const cols = parseCSVLine(header).map(s => s.trim());
  const ix = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0)
      throw new Error(`CSV missing column "${name}" (got: ${cols.join(', ')})`);
    return i;
  };
  const iSlug = ix('slug');
  const iName = ix('name');
  const iDate = ix('date');
  const iBio = ix('bio_en');
  const iCountry = ix('country');
  const iHonored = ix('honored');
  const iParadise = ix('paradise');
  const iTranslation = ix('translation');
  return body
    .map(line => {
      const fields = parseCSVLine(line);
      return {
        slug: (fields[iSlug] ?? '').trim(),
        name: (fields[iName] ?? '').trim(),
        date: (fields[iDate] ?? '').trim(),
        bio_en: (fields[iBio] ?? '').trim(),
        country: (fields[iCountry] ?? '').trim(),
        honored: parseBool(fields[iHonored] ?? ''),
        paradise: parseBool(fields[iParadise] ?? ''),
        translation: (fields[iTranslation] ?? '').trim(),
      };
    })
    .filter(r => r.name.length > 0);
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function applyCatalogFields(rows: Row[]): {
  country: number;
  bio: number;
  translation: number;
  total: number;
  unmatched: string[];
} {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const reciters: any[] = Array.isArray(catalog)
    ? catalog
    : Object.values(catalog);
  const byName = new Map(reciters.map(r => [normalize(r.name), r]));
  let country = 0;
  let bio = 0;
  let translation = 0;
  const unmatched: string[] = [];
  for (const row of rows) {
    const r = byName.get(normalize(row.name));
    if (!r) {
      unmatched.push(row.name);
      continue;
    }
    if (row.country && r.country !== row.country) {
      r.country = row.country;
      country++;
    }
    if (row.bio_en && r.bio_en !== row.bio_en) {
      r.bio_en = row.bio_en;
      bio++;
    }
    if (row.translation && r.translation !== row.translation) {
      r.translation = row.translation;
      translation++;
    }
  }
  const out = Array.isArray(catalog) ? reciters : catalog;
  // Sprint 14 code-review fix — only rewrite the file when something
  // actually changed; otherwise we churn the mtime + dirty git on a
  // re-run with an unchanged CSV.
  if (country + bio + translation > 0) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(out, null, 2) + '\n');
  }
  return {country, bio, translation, total: reciters.length, unmatched};
}

function applyCollectionNames(rows: Row[]): {
  honored: number;
  paradise: number;
  translation: number;
} {
  const honored = rows.filter(r => r.honored).map(r => r.name);
  const paradise = rows.filter(r => r.paradise).map(r => r.name);
  const translationEntries: Array<[string, string]> = rows
    .filter(r => r.translation && r.slug)
    .map(r => [r.slug, r.translation]);

  const file = fs.readFileSync(COLLECTIONS_PATH, 'utf8');
  const writeList = (arrName: string, names: string[]) =>
    names.length === 0
      ? `const ${arrName}: string[] = [];`
      : `const ${arrName}: string[] = [\n${names.map(n => `  '${n.replace(/'/g, "\\'")}',`).join('\n')}\n];`;
  const writeMap = (mapName: string, entries: Array<[string, string]>) =>
    entries.length === 0
      ? `const ${mapName}: Record<string, string> = {};`
      : `const ${mapName}: Record<string, string> = {\n${entries.map(([k, v]) => `  '${k}': '${v.replace(/'/g, "\\'")}',`).join('\n')}\n};`;

  // Sprint 19 (S19.3, TECH_DEBT #62) — AST-based replacement supersedes
  // the prior `.replace(/const X:\s*…[\s\S]*?;/, …)` regex pattern. The
  // greedy regex would have terminated early on any future name containing
  // a literal `];`. AST locates each VariableStatement by name + only the
  // exact source-position byte range of its initializer is rewritten;
  // surrounding source (comments, blank lines, other declarations) is
  // preserved byte-for-byte.
  const sf = ts.createSourceFile(
    COLLECTIONS_PATH,
    file,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  type Patch = {start: number; end: number; text: string};
  const patches: Patch[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.escapedText.toString();
      if (name === 'HONORED_RECITER_NAMES') {
        patches.push({
          start: stmt.getStart(sf),
          end: stmt.getEnd(),
          text: writeList('HONORED_RECITER_NAMES', honored),
        });
      } else if (name === 'PARADISE_RECITER_NAMES') {
        patches.push({
          start: stmt.getStart(sf),
          end: stmt.getEnd(),
          text: writeList('PARADISE_RECITER_NAMES', paradise),
        });
      } else if (name === 'TRANSLATION_RECITER_SLUGS') {
        patches.push({
          start: stmt.getStart(sf),
          end: stmt.getEnd(),
          text: writeMap('TRANSLATION_RECITER_SLUGS', translationEntries),
        });
      }
    }
  }
  if (patches.findIndex(p => /HONORED_RECITER_NAMES/.test(p.text)) === -1) {
    throw new Error(
      'HONORED_RECITER_NAMES VariableStatement not found in collections file via AST scan.',
    );
  }
  if (patches.findIndex(p => /PARADISE_RECITER_NAMES/.test(p.text)) === -1) {
    throw new Error(
      'PARADISE_RECITER_NAMES VariableStatement not found in collections file via AST scan.',
    );
  }
  // Apply patches back-to-front so earlier patches' byte ranges stay valid.
  patches.sort((a, b) => b.start - a.start);
  let next = file;
  for (const p of patches) {
    next = next.slice(0, p.start) + p.text + next.slice(p.end);
  }
  fs.writeFileSync(COLLECTIONS_PATH, next);
  return {
    honored: honored.length,
    paradise: paradise.length,
    translation: translationEntries.length,
  };
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }
  console.log(`Reading CSV: ${CSV_PATH}`);
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csv);
  console.log(`Parsed ${rows.length} rows.`);

  const catalog = applyCatalogFields(rows);
  console.log(
    `Catalog (${catalog.total} reciters): country=${catalog.country}, bio=${catalog.bio}, translation=${catalog.translation} updated.`,
  );
  if (catalog.unmatched.length > 0) {
    console.warn(
      `  ! ${catalog.unmatched.length} CSV row(s) had no catalog match:`,
    );
    for (const name of catalog.unmatched) console.warn(`      ${name}`);
  }

  const tags = applyCollectionNames(rows);
  console.log(
    `Collections: honored=${tags.honored}, paradise=${tags.paradise}, translation=${tags.translation}.`,
  );

  console.log(
    'Done. Re-run `npx tsc --noEmit` and verify the Listen tab in the sim.',
  );
}

main();
