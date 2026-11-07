// @ai
//
// Signals snapshot section `platforms` (derived): v2 and v1 side by side for
// iOS and Android, as of dataThrough. It reads the sections `active`, `stores`
// and `v1Backend`, and runs one PostHog query of its own.
//
//   v2.installsAllTime  distinct installs (PostHog person_id) up to dataThrough,
//                       by the FIRST non-empty $os_name of the install; iPadOS =
//                       iOS; lab devices excluded. An install that never sent
//                       $os_name is in neither platform. (PostHog has v2 only.)
//   v2.mau30            `active` MAU of the platform on dataThrough.
//   Android v1.playUsers7dAvg
//                       `stores` Play v1Users: the mean over the days with a
//                       row in the 7 Play days that end at Play's newest day.
//                       Play drops a row under its threshold (about 50 users),
//                       so null means "under the threshold", not 0.
//   iOS v1.ascDevices7dAvg
//                       `stores` App Sessions v1Devices: the mean daily unique
//                       devices over the days with data in the 7 days that end
//                       at the newest report day (opted-in devices only). A
//                       mean of daily counts, not 7-day unique devices.
//   both.v1Backend.estDevices7d
//                       `v1Backend` distinct client IPs in 7 LA days (both
//                       platforms; the v1 backend cannot tell them apart).
// A missing input is null with a note, never 0. Status: ok when every input
// worked, partial otherwise.

import {labExclusionSQL} from '../../lib/lab-exclusion.mjs';
import {scrub} from '../lib/context.mjs';
import {addDays, cell, laDaySQL, SMALL} from '../lib/rules.mjs';

export const name = 'platforms';
export const required = false;
export const after = ['active', 'stores', 'v1Backend'];
export const PLATFORMS = ['iOS', 'Android'];

export const DEFINITIONS = {
  installsAllTime:
    'distinct v2 installs (PostHog person_id) with any event up to dataThrough (events received by the snapshot asOf), by the first non-empty $os_name of the install; iPadOS = iOS; lab excluded; an install with no $os_name is in neither platform',
  mau30:
    'the active section: distinct installs with any event in the 30 LA days ending at dataThrough',
  playUsers7dAvg:
    "Android v1 (versionCode < 1257): the mean of Play daily distinct users over the days with a row in the 7 Play days ending at the newest Play day; null = no v1 row in those days (under Play's threshold of about 50 users, not 0)",
  ascDevices7dAvg:
    'iOS v1 (app version < 3.1.0): the mean daily unique devices of App Sessions Standard over the days with data in the 7 days ending at the newest report day; opted-in devices only; a mean of daily counts, not 7-day unique devices',
  estDevices7d:
    'the v1Backend section: distinct client IPs of v1 play reports in the 7 LA days ending at dataThrough (both platforms; an estimate)',
};

const cellOrNull = {$ref: '#/$defs/cellOrNull'};
const laDateOrNull = {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]};
const obj = (keys, properties) => ({
  type: 'object',
  required: keys,
  additionalProperties: false,
  properties,
});
const v2Schema = obj(['installsAllTime', 'mau30'], {
  installsAllTime: cellOrNull,
  mau30: cellOrNull,
});

export const schema = obj(
  ['definitions', 'dataThrough', 'iOS', 'Android', 'both'],
  {
    definitions: obj(
      Object.keys(DEFINITIONS),
      Object.fromEntries(
        Object.keys(DEFINITIONS).map(k => [k, {type: 'string'}]),
      ),
    ),
    dataThrough: {$ref: '#/$defs/laDate'},
    iOS: obj(['v2', 'v1'], {
      v2: v2Schema,
      v1: obj(['ascDevices7dAvg', 'through', 'note'], {
        ascDevices7dAvg: cellOrNull,
        through: laDateOrNull,
        note: {type: 'string'},
      }),
    }),
    Android: obj(['v2', 'v1'], {
      v2: v2Schema,
      v1: obj(['playUsers7dAvg', 'through', 'note'], {
        playUsers7dAvg: cellOrNull,
        through: laDateOrNull,
        note: {type: 'string'},
      }),
    }),
    both: obj(['v1Backend'], {
      v1Backend: obj(['estDevices7d', 'note'], {
        estDevices7d: cellOrNull,
        note: {type: 'string'},
      }),
    }),
  },
);

/** HogQL: v2 installs up to `to` by the first non-empty $os_name; one row per platform. */
export function installsQuery(to, asOfWhere = 'true') {
  return `SELECT platform, count() AS installs
     FROM (
       SELECT person_id,
              multiIf(os IN ('iOS', 'iPadOS'), 'iOS', os = 'Android', 'Android', 'unknown') AS platform
       FROM (
         SELECT person_id, argMin(properties.$os_name, timestamp) AS os
         FROM events
         WHERE timestamp < toDateTime('${addDays(to, 2)} 00:00:00') AND ${laDaySQL()} <= toDate('${to}')
           AND properties.$os_name IS NOT NULL AND properties.$os_name != ''
           AND ${asOfWhere} AND ${labExclusionSQL()}
         GROUP BY person_id
       )
     )
     GROUP BY platform
     ORDER BY platform`;
}

/**
 * The mean of a daily series over the days with a value, in the `n` days that
 * end at `through`. Returns {value, used, small}: value is a cell or null.
 */
export function trailingMean(days, values, through, n = 7) {
  if (!through) return {value: null, used: 0, small: 0};
  const from = addDays(through, -(n - 1));
  let sum = 0;
  let used = 0;
  let small = 0;
  days.forEach((d, i) => {
    if (d < from || d > through) return;
    const v = values[i];
    if (v === null || v === undefined) return;
    if (v === SMALL) small++;
    else {
      sum += Number(v);
      used++;
    }
  });
  if (!used) return {value: small ? SMALL : null, used, small};
  return {value: cell(Math.round(sum / used)), used, small};
}

const usable = s =>
  s && (s.status === 'ok' || s.status === 'partial') && s.data;
const stateOf = s =>
  s ? `${s.status}${s.error ? `: ${s.error}` : ''}` : 'missing';

/** The section result from the other sections and the installs rows. */
export function derive(
  sections,
  installRows,
  {dataThrough, installsError = null} = {},
) {
  const notes = [];
  const {active, stores, v1Backend} = sections || {};

  // v2 installs, all time
  let installs = null;
  if (installRows)
    installs = Object.fromEntries(installRows.map(([p, n]) => [p, Number(n)]));
  else
    notes.push(
      `v2 installs: the PostHog query failed${installsError ? ` (${installsError})` : ''}`,
    );

  // v2 MAU
  const mau = p => {
    const s = active?.data?.[p]?.mau;
    return usable(active) && Array.isArray(s) && s.length
      ? s[s.length - 1]
      : null;
  };
  if (!usable(active))
    notes.push(`v2 mau30: the active section is ${stateOf(active)}`);

  const v2 = p => ({
    installsAllTime: installs ? cell(installs[p] ?? 0) : null,
    mau30: mau(p),
  });

  // Android v1, from Play
  const android = stores?.data?.android;
  let play;
  if (usable(stores) && android?.status === 'ok') {
    const m = trailingMean(android.days, android.v1Users, android.dataThrough);
    play = {
      playUsers7dAvg: m.value,
      through: android.dataThrough,
      note: m.used
        ? `mean of ${m.used} of 7 Play days with a v1 row, to ${android.dataThrough}`
        : `Play published no v1 row in the 7 days to ${android.dataThrough}: under its threshold (about 50 users a day), not 0`,
    };
  } else {
    play = {
      playUsers7dAvg: null,
      through: null,
      note: `stores Android part is ${android?.status || stateOf(stores)}${android?.note ? ` (${android.note})` : ''}`,
    };
    notes.push(`Android v1: ${play.note}`);
  }

  // iOS v1, from the App Store reports
  const ios = stores?.data?.ios;
  let asc;
  if (usable(stores) && ios?.status === 'ok') {
    const m = trailingMean(ios.days, ios.v1Devices, ios.dataThrough);
    asc = {
      ascDevices7dAvg: m.value,
      through: ios.dataThrough,
      note:
        m.used || m.small
          ? `mean of ${m.used + m.small} of 7 report days, to ${ios.dataThrough} (opted-in devices only)`
          : `no App Sessions data in the 7 days to ${ios.dataThrough}`,
    };
  } else {
    asc = {
      ascDevices7dAvg: null,
      through: null,
      note: `stores iOS part is ${ios?.status || stateOf(stores)}${ios?.note ? ` (${ios.note})` : ''}`,
    };
    notes.push(`iOS v1: ${asc.note}`);
  }

  // Both platforms, from the v1 backend
  let backend;
  if (usable(v1Backend) && v1Backend.data.d7) {
    backend = {
      estDevices7d: v1Backend.data.d7.estDevices,
      note: `distinct client IPs ${v1Backend.data.d7.from}..${v1Backend.data.d7.to}`,
    };
  } else {
    backend = {
      estDevices7d: null,
      note: `the v1Backend section is ${stateOf(v1Backend)}`,
    };
    notes.push(`v1 backend: ${backend.note}`);
  }

  return {
    status: notes.length ? 'partial' : 'ok',
    notes,
    data: {
      definitions: DEFINITIONS,
      dataThrough,
      iOS: {v2: v2('iOS'), v1: asc},
      Android: {v2: v2('Android'), v1: play},
      both: {v1Backend: backend},
    },
  };
}

export async function collect(ctx) {
  let rows = null;
  let installsError = null;
  try {
    rows = await ctx.hogql(installsQuery(ctx.dataThrough, ctx.asOfSQL), {
      limit: 10,
    });
  } catch (e) {
    installsError = scrub(e?.message || e, ctx.env).slice(0, 160);
  }
  const out = derive(ctx.sections, rows, {
    dataThrough: ctx.dataThrough,
    installsError,
  });
  return {
    status: out.status,
    source:
      'derived from active, stores and v1Backend; PostHog HogQL for v2 installs',
    notes: out.notes,
    data: out.data,
  };
}
