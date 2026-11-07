// @ai-generated
// Qariah (Sprint 47, Pass C): reads a sheet of the Arabic review pack
// (planning/pass-c/arabic-review/*.csv) for the Jest suites that check the
// app's Arabic against it. scripts/publish-to-public.sh strips planning/
// from the public mirror, so a suite uses `itWithReviewPack`, which skips
// when the pack is not there.
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const REVIEW_PACK_DIR = resolve(
  __dirname,
  '../planning/pass-c/arabic-review',
);

export const hasReviewPack = existsSync(REVIEW_PACK_DIR);

export const itWithReviewPack = hasReviewPack ? it : it.skip;

export interface ReviewRow {
  number: string;
  section: string;
  /** The first line of the "Key / where it appears" cell. */
  key: string;
  english: string;
  /** "Reviewer: correction" when it is filled, else "Suggested Arabic". */
  arabic: string;
}

/** RFC 4180: a BOM, CRLF rows, quoted cells with "" and newlines. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
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
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

/** The rows of one sheet, for example `readReviewSheet('countries.csv')`. */
export function readReviewSheet(file: string): ReviewRow[] {
  const [header, ...data] = parseCsv(
    readFileSync(resolve(REVIEW_PACK_DIR, file), 'utf8'),
  );
  const col = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${file}: no column "${name}"`);
    return index;
  };
  const number = col('#');
  const section = col('Section');
  const key = col('Key / where it appears (file:line)');
  const english = col('English');
  const suggested = col('Suggested Arabic');
  const correction = col('Reviewer: correction');
  return data.map(cells => ({
    number: cells[number].trim(),
    section: cells[section].trim(),
    key: cells[key].split('\n')[0].trim(),
    english: cells[english].trim(),
    arabic: cells[correction].trim() || cells[suggested].trim(),
  }));
}
