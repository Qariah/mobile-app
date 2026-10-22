// @ai
//
// Signals snapshot section `weekly`: each LA week (Monday start) from the week
// of the first organic event to the week of dataThrough. The last week is
// partial when dataThrough is not a Sunday (`partialLastWeek` = its Monday).
//
//   newInstalls      installs whose first organic event falls in the week
//   wau              distinct installs with any event in the week
//   listeners        distinct installs with meaningful_listen in the week
//   listens          meaningful_listen count
//   playbackStarted  playback_started count
//   pagesRead        mushaf_page_read count
//   completed        playback_completed count
//
// Splits:
//   byPlatform   every measure, by the platform of the install (the first
//                $os_name that the install sent; iPadOS counts as iOS; no
//                $os_name at all = unknown)
//   byOsMajor, byMaker, byBuild   newInstalls and listeners only. newInstalls
//                takes the value at first seen (the first event that carries
//                it); listeners takes the value of the install's last
//                meaningful_listen in that week. The top 8 values by
//                newInstalls + listeners over all weeks keep a row; the rest,
//                and "unknown", go to `other`.
//
// One query. It resolves each install once (first seen, platform, first
// values) and each install-week once, then counts; it never groups raw events
// for a people count. All versions, lab devices excluded, events received by
// ctx.asOf (so a rerun of a date gives the same numbers). No geography.

import {labExclusionSQL} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  eventCell,
  laDaySQL,
  laDaysWhere,
  weekStart,
} from '../lib/rules.mjs';

export const name = 'weekly';
export const required = false;

// The PostHog project holds no event before 2026-05-07 UTC (checked
// 2026-10-18), so a scan from this date sees every install.
export const SCAN_FROM = '2026-05-01';
export const TOP_N = 8;
export const PLATFORMS = ['iOS', 'Android', 'unknown'];
export const DIMS = {osMajor: 'byOsMajor', maker: 'byMaker', build: 'byBuild'};
const MEASURES = [
  'newInstalls',
  'wau',
  'listeners',
  'listens',
  'playbackStarted',
  'pagesRead',
  'completed',
];

// Display names for the makers that the data sends in more than one spelling.
// The query folds case and a "Mobile Limited" suffix; this map only restores
// the usual capitals.
const MAKER_NAMES = {
  apple: 'Apple',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
  google: 'Google',
  oppo: 'OPPO',
  vivo: 'vivo',
  honor: 'HONOR',
  oneplus: 'OnePlus',
  tecno: 'TECNO',
  infinix: 'Infinix',
  realme: 'realme',
  motorola: 'Motorola',
  huawei: 'Huawei',
  itel: 'itel',
  lenovo: 'Lenovo',
  nothing: 'Nothing',
  'hmd global': 'HMD Global',
  fairphone: 'Fairphone',
  zte: 'ZTE',
  sony: 'Sony',
  asus: 'ASUS',
  lge: 'LGE',
  tcl: 'TCL',
};
export const makerLabel = k =>
  MAKER_NAMES[k] ??
  (k === 'unknown' || k === 'other'
    ? k
    : k.charAt(0).toUpperCase() + k.slice(1));

const weekArray = item => ({type: 'array', items: item});
const cells = weekArray({$ref: '#/$defs/cell'});
const events = weekArray({$ref: '#/$defs/eventCell'});
const series = {
  type: 'object',
  required: MEASURES,
  additionalProperties: false,
  properties: {
    newInstalls: cells,
    wau: cells,
    listeners: cells,
    listens: events,
    playbackStarted: events,
    pagesRead: events,
    completed: events,
  },
};
const split = {
  type: 'array',
  items: {
    type: 'object',
    required: ['label', 'newInstalls', 'listeners'],
    additionalProperties: false,
    properties: {label: {type: 'string'}, newInstalls: cells, listeners: cells},
  },
};

export const schema = {
  type: 'object',
  required: [
    'weeks',
    'through',
    'partialLastWeek',
    'definitions',
    'total',
    'byPlatform',
    ...Object.values(DIMS),
  ],
  additionalProperties: false,
  properties: {
    weeks: weekArray({$ref: '#/$defs/laDate'}),
    through: {$ref: '#/$defs/laDate'},
    partialLastWeek: {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]},
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    total: series,
    byPlatform: {
      type: 'object',
      required: PLATFORMS,
      additionalProperties: false,
      properties: Object.fromEntries(PLATFORMS.map(p => [p, series])),
    },
    ...Object.fromEntries(Object.values(DIMS).map(k => [k, split])),
  },
};

const OS = 'properties.$os_name';
const OSV = 'properties.$os_version';
const BUILD = 'properties.$app_build';
const MAKER = 'properties.$device_manufacturer';
const str = col => `ifNull(${col}, '')`;
const has = col => `notEmpty(${str(col)})`;
// Per event, raw: the OS major ("iOS 26", "iPadOS 18", "Android 16").
const OS_MAJOR = `if(${has(OS)} AND ${has(OSV)}, concat(${str(OS)}, ' ', splitByChar('.', ${str(OSV)})[1]), '')`;
const first = (expr, cond) => `argMinIf(${expr}, timestamp, ${cond})`;
const lastListen = expr =>
  `argMaxIf(${expr}, timestamp, event = 'meaningful_listen')`;
// After the per-week aggregation (few rows): '' → 'unknown'; the maker in
// lower case without a "mobile limited" suffix. Done here, not per event,
// because the regex over every event made the query slow.
const known = v => `if(notEmpty(${v}), ${v}, 'unknown')`;
const maker = v =>
  `if(notEmpty(${v}), replaceRegexpOne(lower(trim(${v})), ' +((mobile|mobility) +)?limited$', ''), 'unknown')`;
// Over all weeks of one install: the value of its first week that knows it.
const W = 'OVER (PARTITION BY person_id)';
const firstWeek = v => `argMinIf(${v}, wk, ${v} != 'unknown') ${W}`;

/**
 * The HogQL query: one row per (week, dim, key). The inner level resolves each
 * install-week; window functions over the install's weeks give its first week
 * and its first values. (A JOIN of a per-install and a per-week subquery gave
 * the same numbers but hit PostHog's time limit.)
 */
export function weeklyQuery(to, asOfWhere = 'true') {
  return `SELECT toString(wk) AS week, dim, key,
       count() AS wau,
       countIf(is_new) AS new_installs,
       countIf(ml > 0) AS listeners, sum(ml) AS listens,
       countIf(ps > 0) AS starters, sum(ps) AS starts,
       countIf(pr > 0) AS readers, sum(pr) AS pages_read,
       countIf(pc > 0) AS completers, sum(pc) AS completed
     FROM (
       SELECT wk, ml, ps, pr, pc,
              ${known('os_major_l')} AS os_major_l2,
              ${known('build_l')} AS build_l2,
              ${maker('maker_l')} AS maker_l2,
              wk = min(wk) ${W} AS is_new,
              ${firstWeek(known('os_w'))} AS os0,
              ${firstWeek(known('os_major_w'))} AS os_major0,
              ${firstWeek(known('build_w'))} AS build0,
              ${firstWeek(maker('maker_w'))} AS maker0
       FROM (
         SELECT person_id, toMonday(${laDaySQL()}) AS wk,
                countIf(event = 'meaningful_listen') AS ml,
                countIf(event = 'playback_started') AS ps,
                countIf(event = 'mushaf_page_read') AS pr,
                countIf(event = 'playback_completed') AS pc,
                ${first(str(OS), has(OS))} AS os_w,
                ${first(OS_MAJOR, `${has(OS)} AND ${has(OSV)}`)} AS os_major_w,
                ${first(str(BUILD), has(BUILD))} AS build_w,
                ${first(str(MAKER), has(MAKER))} AS maker_w,
                ${lastListen(OS_MAJOR)} AS os_major_l,
                ${lastListen(str(BUILD))} AS build_l,
                ${lastListen(str(MAKER))} AS maker_l
         FROM events
         WHERE ${laDaysWhere(SCAN_FROM, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
         GROUP BY person_id, wk
       )
     )
     ARRAY JOIN
       ['total', 'platform', 'osMajor:new', 'osMajor:listen', 'build:new', 'build:listen', 'maker:new', 'maker:listen'] AS dim,
       ['total', multiIf(os0 IN ('iOS', 'iPadOS'), 'iOS', os0 = 'Android', 'Android', 'unknown'),
        if(is_new, os_major0, NULL), if(ml > 0, os_major_l2, NULL),
        if(is_new, build0, NULL), if(ml > 0, build_l2, NULL),
        if(is_new, maker0, NULL), if(ml > 0, maker_l2, NULL)] AS key
     WHERE isNotNull(key)
     GROUP BY wk, dim, key
     ORDER BY wk, dim, key`;
}

const num = v => Number(v) || 0;

/**
 * Rows [week, dim, key, wau, new_installs, listeners, listens, starters,
 * starts, readers, pages_read, completers, completed] → the section data.
 */
export function shape(rows, to) {
  const lastWeek = weekStart(to);
  const scanWeek = weekStart(SCAN_FROM); // no row can be older; ignore one that is
  let startWeek = lastWeek;
  for (const r of rows) {
    const w = String(r[0]).slice(0, 10);
    if (r[1] === 'total' && w < startWeek && w >= scanWeek) startWeek = w;
  }
  const weeks = [];
  for (let w = startWeek; w <= lastWeek; w = addDays(w, 7)) weeks.push(w);
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const zeros = () => weeks.map(() => 0);
  const rawSeries = () => ({
    newInstalls: zeros(),
    wau: zeros(),
    listeners: zeros(),
    listens: zeros(),
    starters: zeros(),
    starts: zeros(),
    readers: zeros(),
    pagesRead: zeros(),
    completers: zeros(),
    completed: zeros(),
  });
  const total = rawSeries();
  const platforms = Object.fromEntries(PLATFORMS.map(p => [p, rawSeries()]));
  // dims[dim][key] = {newInstalls: [..], listeners: [..]}
  const dims = Object.fromEntries(Object.keys(DIMS).map(d => [d, new Map()]));

  for (const r of rows) {
    const i = idx.get(String(r[0]).slice(0, 10));
    if (i === undefined) continue;
    const [, dim, key] = r;
    const [
      wau,
      newInstalls,
      listeners,
      listens,
      starters,
      starts,
      readers,
      pagesRead,
      completers,
      completed,
    ] = r.slice(3).map(num);
    if (dim === 'total' || dim === 'platform') {
      const s = dim === 'total' ? total : platforms[key] || platforms.unknown;
      const add = {
        newInstalls,
        wau,
        listeners,
        listens,
        starters,
        starts,
        readers,
        pagesRead,
        completers,
        completed,
      };
      for (const [k, v] of Object.entries(add)) s[k][i] += v;
      continue;
    }
    const [d, kind] = String(dim).split(':');
    if (!dims[d]) continue;
    const label = d === 'maker' ? makerLabel(String(key)) : String(key);
    const m = dims[d];
    if (!m.has(label)) m.set(label, {newInstalls: zeros(), listeners: zeros()});
    if (kind === 'new') m.get(label).newInstalls[i] += newInstalls;
    else if (kind === 'listen') m.get(label).listeners[i] += listeners;
  }

  const finish = s => ({
    newInstalls: s.newInstalls.map(cell),
    wau: s.wau.map(cell),
    listeners: s.listeners.map(cell),
    listens: s.listens.map((n, i) => eventCell(n, s.listeners[i])),
    playbackStarted: s.starts.map((n, i) => eventCell(n, s.starters[i])),
    pagesRead: s.pagesRead.map((n, i) => eventCell(n, s.readers[i])),
    completed: s.completed.map((n, i) => eventCell(n, s.completers[i])),
  });

  const sum = a => a.reduce((x, y) => x + y, 0);
  const topSplit = m => {
    const ranked = [...m.entries()]
      .filter(([k]) => k !== 'unknown')
      .map(([k, v]) => ({k, v, score: sum(v.newInstalls) + sum(v.listeners)}))
      .sort((a, b) => b.score - a.score || a.k.localeCompare(b.k))
      .slice(0, TOP_N);
    const keep = new Set(ranked.map(r => r.k));
    const other = {newInstalls: zeros(), listeners: zeros()};
    for (const [k, v] of m)
      if (!keep.has(k))
        for (let i = 0; i < weeks.length; i++) {
          other.newInstalls[i] += v.newInstalls[i];
          other.listeners[i] += v.listeners[i];
        }
    return [
      ...ranked.map(r => ({label: r.k, ...r.v})),
      {label: 'other', ...other},
    ].map(r => ({
      label: r.label,
      newInstalls: r.newInstalls.map(cell),
      listeners: r.listeners.map(cell),
    }));
  };

  return {
    weeks,
    through: to,
    partialLastWeek: addDays(lastWeek, 6) > to ? lastWeek : null,
    definitions: {
      week: 'an LA calendar week, Monday to Sunday; the last week ends at `through`; partialLastWeek = the Monday of that week when it is partial (through is not a Sunday), else null; a partial week holds fewer days, so do not compare it with a full week',
      newInstalls:
        'installs whose first organic event (any event) falls in the week',
      wau: 'distinct installs with any event in the week',
      listeners: 'distinct installs that sent meaningful_listen in the week',
      listens: 'meaningful_listen count ("<5" when 1 to 4 listeners)',
      playbackStarted:
        'playback_started count ("<5" when 1 to 4 installs sent it)',
      pagesRead: 'mushaf_page_read count ("<5" when 1 to 4 installs sent it)',
      completed: 'playback_completed count ("<5" when 1 to 4 installs sent it)',
      byPlatform:
        'the platform of the install: the first $os_name it sent; iPadOS counts as iOS; no $os_name = unknown',
      splits: `byOsMajor, byMaker, byBuild: newInstalls by the value at first seen (the first event that carries it); listeners by the value of the install's last meaningful_listen in the week. The top ${TOP_N} by newInstalls + listeners over all weeks keep a row; the rest, and unknown, are "other"`,
      osMajor:
        '$os_name and the major part of $os_version ("iOS 26", "iPadOS 26", "Android 16")',
      maker:
        '$device_manufacturer, case folded, without a "Mobile Limited" suffix',
      build: '$app_build',
      scope:
        'all versions, lab excluded, events received by asOf; no geography',
    },
    total: finish(total),
    byPlatform: Object.fromEntries(
      PLATFORMS.map(p => [p, finish(platforms[p])]),
    ),
    ...Object.fromEntries(
      Object.entries(DIMS).map(([d, k]) => [k, topSplit(dims[d])]),
    ),
  };
}

export async function collect(ctx) {
  const rows = await ctx.hogql(weeklyQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: 50_000,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(rows, ctx.dataThrough),
  };
}
