// @ai
//
// Signals snapshot section `content`: what people listen to and read. The top
// 50 of each list, for two windows that end on dataThrough:
//
//   last30d     the 30 LA days that end on dataThrough
//   since3_2_0  2026-08-03 (LA; 3.2.0 production start) to dataThrough
//
// Lists (installs = distinct installs; events = event count):
//   reciters           meaningful_listen by reciter_id. PRIVACY: an event's
//                      reciter_name can be free text from a user's own
//                      uploaded recording, so the query never reads it. Only a
//                      reciter of the bundled catalog (assets/data/catalog.json,
//                      matched on its id or its slug) gets a row, with the
//                      catalog's name; every other reciter_id goes into one row
//                      "other (not in catalog)" after the top 50. finish = the
//                      share of the listeners with playback_completed for the
//                      same reciter in the window.
//   surahs             the same by surah_id (1 to 114); id = the surah number.
//   riwayah            meaningful_listen by rewayah_id (a recitation id), joined
//                      to the catalog (rewayat[].id → name) and counted by name;
//                      the Hafs spellings are one row. An id that the catalog
//                      does not know goes into "other (not in catalog)".
//                      No finish: playback_completed sends no rewayah_id
//                      (TECH_DEBT #296).
//   mushafPagesRead    mushaf_page_read (15 s or more on a page) by page_number
//                      (1 to 604); surah = the surah_id most installs sent with it.
//   mushafPagesOpened  mushaf_page_opened by page_number, the same way.
//   bookmarks, highlights  "notInstrumented": the app sends no event for them
//                      (TECH_DEBT #297).
//
// A row ranks by installs, then events. A row with "<5" installs keeps its
// label (a catalog reciter, a surah or a page is not personal data); its
// events and its finish are suppressed. All versions, lab devices excluded,
// events received by ctx.asOf.

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  eventCell,
  laDaySQL,
  laDaysWhere,
  rate,
  SMALL,
} from '../lib/rules.mjs';

export const name = 'content';
export const required = false;
export const TOP = 50;
export const SINCE_3_2_0 = '2026-08-03';
export const TRAILING_DAYS = 30;
export const WINDOWS = ['last30d', 'since3_2_0'];
export const HAFS = "Hafs A'n Assem";
export const OTHER_RECITER = 'other (not in catalog)';
export const CATALOG_PATH = 'assets/data/catalog.json';
const OTHER_KEY = '__other__';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const NOT_INSTRUMENTED_NOTE =
  'bookmarks and highlights: notInstrumented — the app sends no analytics event for a bookmark, a note or a highlight (TECH_DEBT #297)';

const labelRow = withFinish => ({
  type: 'object',
  required: ['label', 'installs', 'events', ...(withFinish ? ['finish'] : [])],
  additionalProperties: false,
  properties: {
    label: {type: 'string'},
    installs: {$ref: '#/$defs/cell'},
    events: {$ref: '#/$defs/eventCell'},
    ...(withFinish ? {finish: {$ref: '#/$defs/rate'}} : {}),
  },
});
const surahRow = {
  type: 'object',
  required: ['id', 'installs', 'events', 'finish'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer', minimum: 1, maximum: 114},
    installs: {$ref: '#/$defs/cell'},
    events: {$ref: '#/$defs/eventCell'},
    finish: {$ref: '#/$defs/rate'},
  },
};
const pageRow = {
  type: 'object',
  required: ['id', 'surah', 'installs', 'events'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer', minimum: 1, maximum: 604},
    surah: {type: ['integer', 'null']},
    installs: {$ref: '#/$defs/cell'},
    events: {$ref: '#/$defs/eventCell'},
  },
};
const list = (item, max = TOP) => ({type: 'array', maxItems: max, items: item});
const LISTS = [
  'reciters',
  'surahs',
  'riwayah',
  'mushafPagesRead',
  'mushafPagesOpened',
];

const windowData = {
  type: 'object',
  required: [
    'from',
    'to',
    'totals',
    'distinct',
    ...LISTS,
    'bookmarks',
    'highlights',
  ],
  additionalProperties: false,
  properties: {
    from: {$ref: '#/$defs/laDate'},
    to: {$ref: '#/$defs/laDate'},
    totals: {
      type: 'object',
      required: [
        'listeners',
        'listens',
        'completers',
        'completions',
        'readers',
        'pagesRead',
        'openers',
        'pagesOpened',
      ],
      additionalProperties: false,
      properties: {
        listeners: {$ref: '#/$defs/cell'},
        listens: {$ref: '#/$defs/eventCell'},
        completers: {$ref: '#/$defs/cell'},
        completions: {$ref: '#/$defs/eventCell'},
        readers: {$ref: '#/$defs/cell'},
        pagesRead: {$ref: '#/$defs/eventCell'},
        openers: {$ref: '#/$defs/cell'},
        pagesOpened: {$ref: '#/$defs/eventCell'},
      },
    },
    distinct: {
      type: 'object',
      required: LISTS,
      additionalProperties: false,
      properties: Object.fromEntries(
        LISTS.map(l => [l, {type: 'integer', minimum: 0}]),
      ),
    },
    reciters: list(labelRow(true), TOP + 1), // + the "other (not in catalog)" row
    surahs: list(surahRow),
    riwayah: list(labelRow(false)),
    mushafPagesRead: list(pageRow),
    mushafPagesOpened: list(pageRow),
    bookmarks: {$ref: '#/$defs/notInstrumented'},
    highlights: {$ref: '#/$defs/notInstrumented'},
  },
};

export const schema = {
  type: 'object',
  required: ['definitions', ...WINDOWS],
  additionalProperties: false,
  properties: {
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    last30d: windowData,
    since3_2_0: windowData,
  },
};

/**
 * The names that the lists may show, from the bundled catalog:
 *   reciters  reciter id → name;  slugs  slug → reciter id
 *   riwayah   rewayah id → riwayah name; the Hafs spellings ("Hafs A'n Assem",
 *             "Hafs 'an 'Asim", "Hafs 'an 'Āṣim") fold into one name.
 */
export function catalogNames(catalog) {
  const out = {reciters: new Map(), slugs: new Map(), riwayah: new Map()};
  const reciters = Array.isArray(catalog) ? catalog : catalog?.reciters || [];
  for (const r of reciters) {
    if (r?.id && r?.name) {
      out.reciters.set(String(r.id), String(r.name).trim());
      if (r.slug) out.slugs.set(String(r.slug), String(r.id));
    }
    for (const rw of r?.rewayat || []) {
      if (!rw?.id || !rw?.name) continue;
      const n = String(rw.name).trim();
      out.riwayah.set(String(rw.id), /^hafs\b/i.test(n) ? HAFS : n);
    }
  }
  return out;
}

export function loadCatalogNames(root = ROOT) {
  try {
    return catalogNames(
      JSON.parse(readFileSync(resolve(root, CATALOG_PATH), 'utf8')),
    );
  } catch {
    return catalogNames(null);
  }
}

const EMPTY = catalogNames(null);

// One window bucket per event: since3_2_0 always, last30d when it is recent.
const windowsOf = (to, day) =>
  `arrayJoin(if(${day} >= toDate('${addDays(to, -(TRAILING_DAYS - 1))}'), ['last30d', 'since3_2_0'], ['since3_2_0']))`;
const int = col => `ifNull(toInt(${col}), 0)`;
// HogQL transform() with literal arrays; `fallback` is an SQL expression.
const lookup = (col, map, fallback) =>
  map.size
    ? `transform(${col}, [${sqlList([...map.keys()])}], [${sqlList([...map.values()])}], ${fallback})`
    : fallback;

/** Listening: one row per (window, kind, key); kind 'total' carries the window totals. */
export function listenQuery(to, asOfWhere = 'true', names = EMPTY) {
  // A catalog reciter by id or slug → its id; anything else → OTHER_KEY.
  const toId = new Map([
    ...[...names.reciters.keys()].map(id => [id, id]),
    ...names.slugs,
  ]);
  const rid = `if(notEmpty(ifNull(properties.reciter_id, '')), ${lookup("ifNull(properties.reciter_id, '')", toId, `'${OTHER_KEY}'`)}, '')`;
  const rwy = lookup(
    "ifNull(properties.rewayah_id, '')",
    names.riwayah,
    "ifNull(properties.rewayah_id, '')",
  );
  return `SELECT win, kind, key,
       countIf(ml > 0) AS listeners, sum(ml) AS listens,
       countIf(ml > 0 AND pc > 0) AS finishers,
       countIf(pc > 0) AS completers, sum(pc) AS completions
     FROM (
       SELECT person_id, win, kind, key,
              countIf(event = 'meaningful_listen') AS ml,
              countIf(event = 'playback_completed') AS pc
       FROM (
         SELECT person_id, event, ${windowsOf(to, laDaySQL())} AS win,
                ${rid} AS rid,
                if(${int('properties.surah_id')} BETWEEN 1 AND 114, toString(${int('properties.surah_id')}), '') AS sid,
                if(event = 'meaningful_listen', ${rwy}, '') AS rwy
         FROM events
         WHERE ${laDaysWhere(SINCE_3_2_0, to)} AND ${asOfWhere}
           AND event IN ('meaningful_listen', 'playback_completed') AND ${labExclusionSQL()}
       )
       ARRAY JOIN ['reciter', 'surah', 'riwayah', 'total'] AS kind, [rid, sid, rwy, 'all'] AS key
       WHERE key != ''
       GROUP BY person_id, win, kind, key
     )
     GROUP BY win, kind, key
     ORDER BY win, kind, key`;
}

/** Mushaf: one row per (window, kind, page); key 'all' carries the window totals. */
export function mushafQuery(to, asOfWhere = 'true') {
  return `SELECT win, kind, key, count() AS installs, sum(n) AS events, topK(1)(s) AS surah
     FROM (
       SELECT person_id, win, kind, key, count() AS n, anyIf(surah, surah > 0) AS s
       FROM (
         SELECT person_id, ${windowsOf(to, laDaySQL())} AS win,
                if(event = 'mushaf_page_read', 'read', 'opened') AS kind,
                ${int('properties.page_number')} AS page,
                ${int('properties.surah_id')} AS surah
         FROM events
         WHERE ${laDaysWhere(SINCE_3_2_0, to)} AND ${asOfWhere}
           AND event IN ('mushaf_page_read', 'mushaf_page_opened') AND ${labExclusionSQL()}
       )
       ARRAY JOIN [if(page BETWEEN 1 AND 604, toString(page), ''), 'all'] AS key
       WHERE key != ''
       GROUP BY person_id, win, kind, key
     )
     GROUP BY win, kind, key
     ORDER BY win, kind, key`;
}

const num = v => Number(v) || 0;
const firstOf = v => (Array.isArray(v) ? v[0] : v);
const rank = (a, b) =>
  b.n - a.n ||
  b.e - a.e ||
  String(a.k).localeCompare(String(b.k), 'en', {numeric: true});

/**
 * listenRows: [win, kind, key, listeners, listens, finishers, completers,
 * completions]; mushafRows: [win, kind, key, installs, events, surahTopK].
 */
export function shape(listenRows, mushafRows, to, names = EMPTY) {
  const riwayahNames = new Set(names.riwayah.values());
  const unmapped = new Set();
  const win = () => ({
    reciters: [],
    other: null,
    surahs: [],
    riwayah: [],
    read: [],
    opened: [],
    totals: {},
  });
  const acc = {last30d: win(), since3_2_0: win()};

  for (const r of listenRows) {
    const [w, kind, key] = r;
    const [listeners, listens, finishers, completers, completions] = r
      .slice(3)
      .map(num);
    const a = acc[w];
    if (!a) continue;
    if (kind === 'total') {
      Object.assign(a.totals, {listeners, listens, completers, completions});
    } else if (kind === 'reciter') {
      const label = names.reciters.get(String(key));
      // Not a catalog reciter (or no catalog): never show its id or a name.
      if (key === OTHER_KEY || !label) {
        const o = (a.other ||= {n: 0, e: 0, f: 0});
        Object.assign(o, {
          n: o.n + listeners,
          e: o.e + listens,
          f: o.f + finishers,
        });
      } else
        a.reciters.push({k: label, n: listeners, e: listens, f: finishers});
    } else if (kind === 'surah') {
      a.surahs.push({k: Number(key), n: listeners, e: listens, f: finishers});
    } else if (kind === 'riwayah') {
      // An id that the catalog does not know is never published as a label:
      // it could be any id the app sends (test plan T-PRIV-03). Such rows go
      // into one "other (not in catalog)" row, always last. Its installs are
      // summed over the ids, so it can count an install twice; when any part
      // is 1 to 4 installs, the row shows "<5", so a sum cannot lift a hidden
      // group above 4 (test plan N-1).
      if (riwayahNames.has(String(key))) {
        a.riwayah.push({k: String(key), n: listeners, e: listens});
      } else {
        unmapped.add(String(key));
        const o = (a.riwayahOther ||= {n: 0, e: 0, small: false});
        o.n += listeners;
        o.e += listens;
        if (listeners >= 1 && listeners <= 4) o.small = true;
      }
    }
  }
  for (const r of mushafRows) {
    const [w, kind, key, installs, events, surah] = r;
    const a = acc[w];
    if (!a || (kind !== 'read' && kind !== 'opened')) continue;
    if (key === 'all') {
      if (kind === 'read')
        Object.assign(a.totals, {
          readers: num(installs),
          pagesRead: num(events),
        });
      else
        Object.assign(a.totals, {
          openers: num(installs),
          pagesOpened: num(events),
        });
      continue;
    }
    const s = num(firstOf(surah));
    a[kind].push({
      k: Number(key),
      n: num(installs),
      e: num(events),
      s: s >= 1 && s <= 114 ? s : null,
    });
  }

  const top = rows => [...rows].sort(rank).slice(0, TOP);
  const finishRow = r => ({
    installs: cell(r.n),
    events: eventCell(r.e, r.n),
    finish: rate(r.f, r.n),
  });
  const out = {};
  for (const w of WINDOWS) {
    const a = acc[w];
    const t = {
      listeners: 0,
      listens: 0,
      completers: 0,
      completions: 0,
      readers: 0,
      pagesRead: 0,
      openers: 0,
      pagesOpened: 0,
      ...a.totals,
    };
    // The query folds every non-catalog reciter_id into one key, so the "other"
    // row counts distinct installs over all of them.
    const other = a.other
      ? [{label: OTHER_RECITER, ...finishRow(a.other)}]
      : [];
    out[w] = {
      from: w === 'last30d' ? addDays(to, -(TRAILING_DAYS - 1)) : SINCE_3_2_0,
      to,
      totals: {
        listeners: cell(t.listeners),
        listens: eventCell(t.listens, t.listeners),
        completers: cell(t.completers),
        completions: eventCell(t.completions, t.completers),
        readers: cell(t.readers),
        pagesRead: eventCell(t.pagesRead, t.readers),
        openers: cell(t.openers),
        pagesOpened: eventCell(t.pagesOpened, t.openers),
      },
      distinct: {
        reciters: a.reciters.length,
        surahs: a.surahs.length,
        riwayah: a.riwayah.length,
        mushafPagesRead: a.read.length,
        mushafPagesOpened: a.opened.length,
      },
      reciters: [
        ...top(a.reciters).map(r => ({label: r.k, ...finishRow(r)})),
        ...other,
      ],
      surahs: top(a.surahs).map(r => ({id: r.k, ...finishRow(r)})),
      riwayah: [
        ...top(a.riwayah).map(r => ({
          label: r.k,
          installs: cell(r.n),
          events: eventCell(r.e, r.n),
        })),
        ...(a.riwayahOther
          ? [
              {
                label: OTHER_RECITER,
                installs: a.riwayahOther.small ? SMALL : cell(a.riwayahOther.n),
                events: a.riwayahOther.small
                  ? SMALL
                  : eventCell(a.riwayahOther.e, a.riwayahOther.n),
              },
            ]
          : []),
      ],
      mushafPagesRead: top(a.read).map(r => ({
        id: r.k,
        surah: r.s,
        installs: cell(r.n),
        events: eventCell(r.e, r.n),
      })),
      mushafPagesOpened: top(a.opened).map(r => ({
        id: r.k,
        surah: r.s,
        installs: cell(r.n),
        events: eventCell(r.e, r.n),
      })),
      bookmarks: 'notInstrumented',
      highlights: 'notInstrumented',
    };
  }

  const notes = [NOT_INSTRUMENTED_NOTE];
  if (!names.reciters.size)
    notes.push(
      `${CATALOG_PATH} was not readable: every reciter and every riwayah is in "${OTHER_RECITER}"`,
    );
  else if (unmapped.size)
    notes.push(
      `riwayah: ${unmapped.size} rewayah_id value(s) are not in ${CATALOG_PATH}; they are in "${OTHER_RECITER}"`,
    );

  return {
    data: {
      definitions: {
        windows: `last30d = the ${TRAILING_DAYS} LA days that end on dataThrough; since3_2_0 = ${SINCE_3_2_0} (3.2.0 production start, LA) to dataThrough`,
        installs:
          'distinct installs (one person_id = one install); all versions, lab excluded, events received by asOf',
        reciters: `meaningful_listen by reciter_id; only reciters of the bundled catalog ${CATALOG_PATH} (matched on id or slug) get a row, with the catalog's name; every other reciter_id is in the last row "${OTHER_RECITER}" (distinct installs over all of them). The event's reciter_name is never read: it can be free text from a user's own upload. installs = listeners, events = meaningful_listen count`,
        surahs:
          'meaningful_listen by surah_id (1 to 114; the app sends no surah name); id = the surah number',
        finish:
          'rate: num = listeners who also sent playback_completed for the same reciter (or surah) in the window, den = listeners',
        riwayah: `meaningful_listen by rewayah_id (a recitation id), joined to ${CATALOG_PATH} (rewayat[].id → name) and counted by name; the Hafs spellings are one row ("${HAFS}"); "* Translation" rows are translation audio; an id that the catalog does not know goes into "${OTHER_RECITER}" (installs summed over the ids); no finish rate: playback_completed sends no rewayah_id (TECH_DEBT #296)`,
        mushafPagesRead:
          'mushaf_page_read (the page stayed visible for 15 s or more) by page_number (1 to 604); surah = the surah_id most installs sent with the page',
        mushafPagesOpened:
          'mushaf_page_opened by page_number; opening a page is not reading it',
        totals:
          'distinct installs and event counts over the whole window (listeners/listens = meaningful_listen, completers/completions = playback_completed, readers/pagesRead = mushaf_page_read, openers/pagesOpened = mushaf_page_opened)',
        distinct:
          'the number of distinct values in the window (reciters: catalog reciters only); the lists show the top 50',
        rank: 'by installs, then events; a "<5" row keeps its label, its events and finish are suppressed',
        bookmarks:
          'notInstrumented: the app sends no event when a bookmark is added or removed (TECH_DEBT #297)',
        highlights:
          'notInstrumented: the app sends no event for a verse highlight or note (TECH_DEBT #297)',
      },
      ...out,
    },
    notes,
  };
}

export async function collect(ctx) {
  const names = loadCatalogNames(ctx.root || ROOT);
  const listenRows = await ctx.hogql(
    listenQuery(ctx.dataThrough, ctx.asOfSQL, names),
    {limit: 10_000},
  );
  const mushafRows = await ctx.hogql(
    mushafQuery(ctx.dataThrough, ctx.asOfSQL),
    {limit: 10_000},
  );
  const {data, notes} = shape(listenRows, mushafRows, ctx.dataThrough, names);
  return {
    status: 'ok',
    source: `PostHog HogQL; names from ${CATALOG_PATH}`,
    data,
    notes,
  };
}
