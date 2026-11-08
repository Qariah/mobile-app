// @ai Qariah (Lite mode plan, section 7h) — a cache of two query results of
// the bundled Mushaf DBs: the verse index of a words DB and the page lines of
// the layout DB.
//
// On a Samsung A10s the two queries took 2.3 s of every reader open after a
// launch: the async calls wait behind the other work of the launch. A result
// is stored under the content-addressed name of the DB copy (the hash of its
// bundled asset), so an entry always describes exactly that asset. The caller
// writes an entry only from a copy whose md5 matched the asset, and checks a
// decoded entry like a query result.
import {createMMKV, type MMKV} from 'react-native-mmkv';

export type DkQueryKind = 'verses' | 'lines';

// Bump when an encoding below changes; older entries are then removed.
const FORMAT = 1;

let store: MMKV | null | undefined;

function mmkv(): MMKV | null {
  if (store === undefined) {
    try {
      store = createMMKV({id: 'mushaf-dk-queries'});
    } catch {
      store = null;
    }
  }
  return store;
}

const keyOf = (kind: DkQueryKind, base: string, name: string): string =>
  `${FORMAT}:${kind}:${base}:${name}`;

/** The stored values, or null when there is no usable entry. */
export function readDkQuery(
  kind: DkQueryKind,
  base: string,
  name: string,
): Int32Array | null {
  try {
    const buffer = mmkv()?.getBuffer(keyOf(kind, base, name));
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) {
      return null;
    }
    return new Int32Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Stores `values` for the copy `name` of `base`, and removes the entries of
 * other copies of `base` (other data versions, older formats).
 */
export function writeDkQuery(
  kind: DkQueryKind,
  base: string,
  name: string,
  values: Int32Array,
): void {
  const kv = mmkv();
  if (!kv) return;
  try {
    const key = keyOf(kind, base, name);
    const marker = `:${kind}:${base}:`;
    for (const other of kv.getAllKeys()) {
      if (other !== key && other.includes(marker)) kv.remove(other);
    }
    kv.set(key, values.slice().buffer);
  } catch {
    // A cache only: the next launch runs the query again.
  }
}

/** Removes every entry (the service deleted its DB copies). */
export function clearDkQueries(): void {
  try {
    mmkv()?.clearAll();
  } catch {
    // Nothing to do: a stale entry still matches only its own asset.
  }
}

// --- Verse index: [surah, ayah, first, last] for each verse. ---

export interface VerseRangeRow {
  surah: number;
  ayah: number;
  first: number;
  last: number;
}

export function encodeVerseRows(rows: readonly VerseRangeRow[]): Int32Array {
  const out = new Int32Array(rows.length * 4);
  rows.forEach((row, i) => {
    out[i * 4] = row.surah;
    out[i * 4 + 1] = row.ayah;
    out[i * 4 + 2] = row.first;
    out[i * 4 + 3] = row.last;
  });
  return out;
}

export function decodeVerseRows(values: Int32Array): VerseRangeRow[] | null {
  if (values.length % 4 !== 0) return null;
  const rows: VerseRangeRow[] = new Array(values.length / 4);
  for (let i = 0; i < rows.length; i++) {
    rows[i] = {
      surah: values[i * 4],
      ayah: values[i * 4 + 1],
      first: values[i * 4 + 2],
      last: values[i * 4 + 3],
    };
  }
  return rows;
}

// --- Page lines: the 7 columns of the pages table for each line. ---

const LINE_COLUMNS = [
  'page_number',
  'line_number',
  'line_type',
  'is_centered',
  'first_word_id',
  'last_word_id',
  'surah_number',
] as const;
type LineRow = Record<(typeof LINE_COLUMNS)[number], unknown>;

const LINE_TYPE_CODES = ['surah_name', 'basmallah', 'ayah'] as const;
// The table stores an empty field as '' (or NULL): kept exactly.
const EMPTY_TEXT = -1;
const NULL_VALUE = -2;

function encodeField(value: unknown): number | null {
  if (value === '') return EMPTY_TEXT;
  if (value === null) return NULL_VALUE;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value <= 0x7fffffff ? value : null;
  }
  return null;
}

function decodeField(code: number): number | string | null {
  if (code === EMPTY_TEXT) return '';
  if (code === NULL_VALUE) return null;
  return code;
}

/** Null when a row holds a value the encoding cannot keep exactly. */
export function encodeLineRows(rows: readonly object[]): Int32Array | null {
  const width = LINE_COLUMNS.length;
  const out = new Int32Array(rows.length * width);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as LineRow;
    if (Object.keys(row).length !== width) return null;
    for (let c = 0; c < width; c++) {
      const column = LINE_COLUMNS[c];
      let code: number | null;
      if (column === 'line_type') {
        const type = LINE_TYPE_CODES.indexOf(
          row.line_type as (typeof LINE_TYPE_CODES)[number],
        );
        code = type < 0 ? null : type;
      } else {
        code = encodeField(row[column]);
      }
      if (code === null) return null;
      out[i * width + c] = code;
    }
  }
  return out;
}

export function decodeLineRows<T>(values: Int32Array): T[] | null {
  const width = LINE_COLUMNS.length;
  if (values.length % width !== 0) return null;
  const rows: T[] = new Array(values.length / width);
  for (let i = 0; i < rows.length; i++) {
    const row: Record<string, unknown> = {};
    for (let c = 0; c < width; c++) {
      const code = values[i * width + c];
      const column = LINE_COLUMNS[c];
      if (column === 'line_type') {
        const type = LINE_TYPE_CODES[code];
        if (type === undefined) return null;
        row[column] = type;
      } else {
        row[column] = decodeField(code);
      }
    }
    rows[i] = row as T;
  }
  return rows;
}
