// @ai
//
// Signals snapshot section `health`: Sentry release health for each v2
// release with 50 or more sessions in the last 14 days, from
// `scripts/release-health.mjs --json`. That flag files nothing (it implies
// --dry-run and returns before the filing step).
//
//   sessions          Sentry sessions of the release in the window
//   users             distinct Sentry users of the release in the window
//   crashFreeSessionShare  share of sessions that did not crash (Sentry's value)
//   crashFreeUserShare     share of users who did not crash (Sentry's value)
//   pass              both shares meet the documented gate
//                     (docs/operations/diagnostics-and-release-health.md §3)
//
// v2 = versionCode 500 or more (the script's floor). Sentry's 14-day window is
// trailing at run time; Sentry has no LA calendar day for this query.

import {cell, eventCell} from '../lib/rules.mjs';

export const name = 'health';
export const required = false;
export const SCRIPT = ['scripts/release-health.mjs', '--json'];
export const MIN_SESSIONS = 50;

export const DEFINITION =
  'Sentry Sessions API through release-health.mjs --json, trailing 14 days at run time, all environments, versionCode 500 or more, 50 sessions or more. crashFreeSessionShare and crashFreeUserShare are the shares Sentry computes (0 to 1; the names end in Share, so the small-cell scan does not read a share of 1 as a count). pass = crashFreeSessionShare >= thresholds.session and crashFreeUserShare >= thresholds.user (a null share passes, as in the script)';

const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
const share = {type: ['number', 'null'], minimum: 0, maximum: 1};

export const schema = obj({
  definition: {type: 'string'},
  window: obj({
    period: {type: 'string'},
    from: {type: ['string', 'null']},
    to: {type: 'string'},
  }),
  minSessions: {type: 'integer', minimum: 0},
  thresholds: obj({session: {type: 'number'}, user: {type: 'number'}}),
  releases: {
    type: 'array',
    items: obj({
      release: {type: 'string'},
      versionCode: {type: ['integer', 'null']},
      sessions: {$ref: '#/$defs/eventCell'},
      users: {$ref: '#/$defs/cellOrNull'},
      crashFreeSessionShare: share,
      crashFreeUserShare: share,
      sessionPass: {type: 'boolean'},
      userPass: {type: 'boolean'},
      pass: {type: 'boolean'},
    }),
  },
  failing: {type: 'integer', minimum: 0},
});

const num = v => (v === null || v === undefined ? null : Number(v));

/** Sentry's statsPeriod ('14d', '24h') in milliseconds; null when unknown. */
export function periodMs(p) {
  const m = String(p || '').match(/^(\d+)([dh])$/);
  return m ? Number(m[1]) * (m[2] === 'd' ? 86_400_000 : 3_600_000) : null;
}

/**
 * The release-health JSON → the section data (releases with >= minSessions).
 * measuredAt = when the script ran; Sentry's window is the period before it.
 */
export function shape(out, {measuredAt}) {
  const min = Number(out.minSessions) || MIN_SESSIONS;
  const period = String(out.window || '14d');
  const to = new Date(measuredAt);
  const span = periodMs(period);
  const releases = (out.releases || [])
    .filter(r => Number(r.sessions) >= min)
    .sort((a, b) => Number(b.sessions) - Number(a.sessions))
    .map(r => {
      const users = num(r.users);
      return {
        release: String(r.release),
        versionCode: Number.isInteger(r.versionCode) ? r.versionCode : null,
        // A session count is an event count: suppress it when its users are 1 to 4.
        sessions: eventCell(
          Number(r.sessions) || 0,
          users ?? Number(r.sessions),
        ),
        users: users === null ? null : cell(users),
        crashFreeSessionShare: num(r.cfSession),
        crashFreeUserShare: num(r.cfUser),
        sessionPass: !!r.sessionOk,
        userPass: !!r.userOk,
        pass: !!r.ok,
      };
    });
  return {
    definition: DEFINITION,
    window: {
      period,
      from: span ? new Date(to.getTime() - span).toISOString() : null,
      to: to.toISOString(),
    },
    minSessions: min,
    thresholds: {
      session: Number(out.thresholds?.session),
      user: Number(out.thresholds?.user),
    },
    releases,
    failing: releases.filter(r => !r.pass).length,
  };
}

export async function collect(ctx) {
  const source = 'scripts/release-health.mjs --json (Sentry Sessions API)';
  if (!ctx.sentry())
    return {
      status: 'not_configured',
      source,
      data: null,
      notes: ['SENTRY_READ_TOKEN is not set'],
    };
  const measuredAt = new Date().toISOString();
  const out = await ctx.runScript(SCRIPT, {timeoutMs: 180_000});
  return {status: 'ok', source, data: shape(out, {measuredAt})};
}
