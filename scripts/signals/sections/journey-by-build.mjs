// @ai
//
// Signals snapshot section `journeyByBuild`: people and the journey for every
// v2 build, for the Engagement page card "People and the journey" (owner
// decisions 2026-10-25, D1 and D2).
//
// Three windows of LA days that end at dataThrough:
//   d7      the last 7 days (since 2026-10-30; older files have none)
//   d30     the last 30 days
//   launch  since the v2 launch, 2026-08-02 (active-rollout.json
//           previousRollout_3_2_0.startedAt: the first v2 release to
//           production on both stores)
//
// For each window:
//   all     every v2 install with an event in the window, and its iOS and
//           Android split
//   rows    one row for each production build (active-rollout.json
//           card.builds), and for each older build with MIN_INSTALLS or more
//           installs; then one row for the beta builds (a version above the
//           newest production version) and one row for the other builds
//           (under MIN_INSTALLS installs each). A group row counts each
//           install once, however many of its builds the install used.
//
// An install = a PostHog person_id. The platform of an install on a build:
// iOS when any of its events there says iOS or iPadOS, else Android (as the
// Daily card: no $os_name counts as Android). The journey steps are the
// Daily card's (scripts/lib/journey-steps.mjs), without "Installed". A person
// who updated counts under each build that they used, so the rows add up to
// more than `all`. v2 = $app_build 500 or more. Lab devices excluded, events
// received by asOf.

import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {cardBuilds} from '../../lib/card-layout.mjs';
import {STEPS, stepCond} from '../../lib/journey-steps.mjs';
import {addDays, cell, laDaysWhere} from '../lib/rules.mjs';

export const name = 'journeyByBuild';
export const required = false;
export const addedAt = '2026-10-25';
export const SOURCE = 'PostHog HogQL';
export const V2_LAUNCH = '2026-08-02';
/** Owner 2026-10-25 (D2): a build under this many installs goes into the "other" row. */
export const MIN_INSTALLS = 25;
export const V2_MIN_BUILD = 500;
export const ROW_LIMIT = 2000;

/** The journey steps of the rows: the Daily card's, without "Installed". */
export const JOURNEY = STEPS.filter(s => s.key !== 'installed');
const KEYS = JOURNEY.map(s => s.key);

export const DEFINITIONS = {
  windows:
    'LA days ending at dataThrough: d7 = the last 7 days (since 2026-10-30); d30 = the last 30 days; launch = from 2026-08-02 (the first v2 release to production on both stores). Events received by asOf, lab devices excluded, v2 = $app_build 500 or more',
  installs:
    'distinct installs (PostHog person_id) with any event on the build in the window. The platform of an install on a build is iOS when any of its events there says iOS or iPadOS, else Android. A person who updated counts under each build they used, so the rows add up to more than all',
  journey:
    'installs that reached each step in the window, on that build (the Daily card steps, scripts/lib/journey-steps.mjs): Opened = cold_start_began; Past loading = splash_hidden or screen_content_rendered; Logged in = sign_in_succeeded, or onboarding_completed with signed_in = true (a floor); Started = playback_started or mushaf_page_opened; Really used = meaningful_listen, mushaf_page_read or playback_completed',
  rows: 'one row for each production build (active-rollout.json card.builds) and each older build with 25 or more installs in the window; beta = the builds whose version is above the newest production version, in one row; other = the remaining builds (under 25 installs each), in one row. A group row counts each install once',
};

const C = {$ref: '#/$defs/cell'};
const counts = Object.fromEntries(['installs', ...KEYS].map(k => [k, C]));
const rowSchema = {
  type: 'object',
  required: ['key', 'kind', 'installs', ...KEYS],
  additionalProperties: false,
  properties: {
    key: {type: 'string'},
    kind: {enum: ['build', 'beta', 'other']},
    platform: {enum: ['iOS', 'Android']},
    version: {type: 'string'},
    build: {type: 'string'},
    production: {type: 'boolean'},
    builds: {type: 'integer', minimum: 1},
    ...counts,
  },
};
const windowSchema = {
  type: 'object',
  required: ['from', 'to', 'all', 'rows'],
  additionalProperties: false,
  properties: {
    from: {$ref: '#/$defs/laDate'},
    to: {$ref: '#/$defs/laDate'},
    all: {
      type: 'object',
      required: ['installs', 'iOS', 'Android', ...KEYS],
      additionalProperties: false,
      properties: {...counts, iOS: C, Android: C},
    },
    rows: {type: 'array', items: rowSchema},
  },
};

export const schema = {
  type: 'object',
  required: [
    'definitions',
    'dataThrough',
    'launch',
    'productionVersion',
    'minInstalls',
    'windows',
  ],
  additionalProperties: false,
  properties: {
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    dataThrough: {$ref: '#/$defs/laDate'},
    launch: {$ref: '#/$defs/laDate'},
    productionVersion: {type: ['string', 'null']},
    minInstalls: {type: 'integer'},
    windows: {
      type: 'object',
      // d7 arrived on 2026-10-30: optional, so older files stay valid.
      required: ['d30', 'launch'],
      additionalProperties: false,
      properties: {d7: windowSchema, d30: windowSchema, launch: windowSchema},
    },
  },
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** HogQL: one row for each (install, build) in the window, with its step counts. */
function perInstallBuild(from, to, asOfWhere) {
  const steps = JOURNEY.map(s => `countIf(${stepCond(s)}) AS ${s.key}`).join(
    ',\n           ',
  );
  return `SELECT person_id,
           toString(properties.$app_build) AS build,
           if(countIf(properties.$os_name IN ('iOS', 'iPadOS')) > 0, 'iOS', 'Android') AS plat,
           any(toString(properties.$app_version)) AS ver,
           ${steps}
         FROM events
         WHERE ${laDaysWhere(from, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
           AND toIntOrZero(toString(properties.$app_build)) >= ${V2_MIN_BUILD}
         GROUP BY person_id, build`;
}

const reach = (k = '') =>
  KEYS.map(key => `countIf(${k}${key} > 0) AS ${key}`).join(', ');

/** HogQL: installs and journey for each (platform, build). */
export function buildsQuery(from, to, asOfWhere = 'true') {
  return `SELECT plat, build, any(ver) AS version, count() AS installs, ${reach()}
     FROM (${perInstallBuild(from, to, asOfWhere)})
     GROUP BY plat, build
     ORDER BY installs DESC, plat, build`;
}

/**
 * HogQL: installs and journey for the groups, each install once: `beta` and
 * `other` (the "<platform>-<build>" keys of each), `all`, `all-iOS` and
 * `all-Android`.
 */
export function groupsQuery(
  from,
  to,
  {beta = [], other = []},
  asOfWhere = 'true',
) {
  const inKeys = keys => (keys.length ? `key IN (${sqlList(keys)})` : 'false');
  const maxes = KEYS.map(k => `max(${k}) AS ${k}`).join(', ');
  return `SELECT g, count() AS installs, ${reach()}
     FROM (
       SELECT person_id, g, ${maxes}
       FROM (
         SELECT person_id, ${KEYS.join(', ')},
                arrayJoin([
                  multiIf(${inKeys(beta)}, 'beta', ${inKeys(other)}, 'other', ''),
                  'all',
                  concat('all-', plat)
                ]) AS g
         FROM (
           SELECT *, concat(plat, '-', build) AS key
           FROM (${perInstallBuild(from, to, asOfWhere)})
         )
       )
       WHERE g != ''
       GROUP BY person_id, g
     )
     GROUP BY g
     ORDER BY g`;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** Compare two dotted versions numerically: -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = String(a)
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The newest version among the production builds, or null. */
export function productionVersion(builds) {
  return builds.reduce(
    (best, b) =>
      b.version && (!best || compareVersions(b.version, best) > 0)
        ? b.version
        : best,
    null,
  );
}

const countsOf = (r, offset) =>
  Object.fromEntries(
    ['installs', ...KEYS].map((k, i) => [k, cell(Number(r[offset + i]) || 0)]),
  );

/**
 * buildsQuery rows → each build's place: production, an own row (MIN_INSTALLS
 * or more), beta, or other. → {rows (own rows, in order), beta keys, other
 * keys}. A production build with no installs in the window has no row.
 */
export function classify(buildRows, production) {
  const prodKeys = new Set(production.map(b => `${b.platform}-${b.build}`));
  const prodVersion = productionVersion(production);
  const own = [];
  const beta = [];
  const other = [];
  for (const r of buildRows) {
    const [plat, build, version] = r;
    const installs = Number(r[3]) || 0;
    const key = `${plat}-${build}`;
    const isProd = prodKeys.has(key);
    const row = {
      key,
      kind: 'build',
      platform: plat,
      version: String(version ?? ''),
      build: String(build),
      production: isProd,
      ...countsOf(r, 3),
    };
    if (isProd) own.push(row);
    else if (
      prodVersion &&
      version &&
      compareVersions(version, prodVersion) > 0
    )
      beta.push(key);
    else if (installs >= MIN_INSTALLS) own.push(row);
    else other.push(key);
  }
  // Production builds first (iOS, then Android, newest build first), then
  // the older builds with the most installs.
  const order = {iOS: 0, Android: 1};
  const prod = own
    .filter(r => r.production)
    .sort(
      (a, b) =>
        order[a.platform] - order[b.platform] ||
        Number(b.build) - Number(a.build),
    );
  const older = own.filter(r => !r.production);
  return {rows: [...prod, ...older], beta, other};
}

/** groupsQuery rows + classify() → one window of the section data. */
export function shapeWindow({from, to}, classified, groupRows) {
  const byG = new Map(groupRows.map(r => [String(r[0]), r]));
  const zero = ['g', ...Array(KEYS.length + 1).fill(0)];
  const all = countsOf(byG.get('all') || zero, 1);
  const rows = [...classified.rows];
  for (const kind of ['beta', 'other']) {
    const keys = classified[kind];
    if (!keys.length) continue;
    rows.push({
      key: kind,
      kind,
      builds: keys.length,
      ...countsOf(byG.get(kind) || zero, 1),
    });
  }
  return {
    from,
    to,
    all: {
      ...all,
      iOS: cell(Number((byG.get('all-iOS') || zero)[1]) || 0),
      Android: cell(Number((byG.get('all-Android') || zero)[1]) || 0),
    },
    rows,
  };
}

export async function collect(ctx) {
  const to = ctx.dataThrough;
  const production = cardBuilds(ctx.cfg);
  const windows = {
    d7: {from: addDays(to, -6), to},
    d30: {from: addDays(to, -29), to},
    launch: {from: V2_LAUNCH, to},
  };
  const out = {};
  for (const [k, w] of Object.entries(windows)) {
    const buildRows = await ctx.hogql(buildsQuery(w.from, w.to, ctx.asOfSQL), {
      limit: ROW_LIMIT,
    });
    const classified = classify(buildRows, production);
    const groupRows = await ctx.hogql(
      groupsQuery(w.from, w.to, classified, ctx.asOfSQL),
      {limit: 10},
    );
    out[k] = shapeWindow(w, classified, groupRows);
  }
  return {
    status: 'ok',
    source: SOURCE,
    data: {
      definitions: DEFINITIONS,
      dataThrough: to,
      launch: V2_LAUNCH,
      productionVersion: productionVersion(production),
      minInstalls: MIN_INSTALLS,
      windows: out,
    },
  };
}
