// @ai
//
// Signals snapshot section `engagement`: each watched build
// (active-rollout.json engagement.buildsToWatch), from
// `scripts/rollout-engagement.mjs --json`.
//
//   users        organic installs on the build in the window (lab excluded)
//   labUsers     lab installs on the build (never in any rate)
//   activation   matured installs that reached a core-value event
//   retention    came back on a 2nd day / D7 / D28, each over its matured installs
//   pastSplash   launchers that reached splash_hidden or screen_content_rendered
//   core         reach and events of each core-value event
//
// The window is the script's own: the trailing N days at run time (default 30;
// it halves once when PostHog times out). window.from and window.to state it;
// the script applies no ingestion cut-off (ctx.asOf). The cohorts and the alert texts stay
// out: the cohorts are diagnosis, and an alert text holds raw small counts.
// rollout-engagement.mjs gives each rate as a fraction with its sample; this
// section turns it back into {num, den} with rate(), so the small-cell rule
// applies. retentionD7 / retentionD28 are new fields of the script; when the
// script does not send them, the section shows null.

import {cell, eventCell, rate} from '../lib/rules.mjs';

export const name = 'engagement';
export const required = false;
// 45 days: D28 needs installs at least 29 full days old, which a 30-day
// window can never hold (test plan T-SCH-13). The script halves the window
// once when PostHog times out; data.window records the window it used.
export const SCRIPT = ['scripts/rollout-engagement.mjs', '--json', '--days=45'];

export const DEFINITION =
  'rollout-engagement.mjs --json, trailing window at run time. users = organic installs (PostHog person_id, lab excluded) with any event on the build; labUsers = lab installs. activation = matured installs (48 h or more since first seen) that reached meaningful_listen, mushaf_page_read or playback_completed. retention: secondDay = matured installs active on 2 or more days ("came back on a 2nd day"); d7 and d28 as the script defines them (planning/signals-phase1-design.md); null when the script does not send them. share is null when the matured count is below the script threshold. Retention counts activity on the SAME build: an install that updated to a newer build counts as not retained, so read it as "stayed on this build" (a build that users leave by an update reads low). pastSplash = installs with splash_hidden or screen_content_rendered / installs with cold_start_began. core = installs (and events) of each core-value event; "notInstrumented" when the build never sent the event';

const C = {$ref: '#/$defs/cell'};
const R = {$ref: '#/$defs/rate'};
const NI = {$ref: '#/$defs/notInstrumented'};
const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
const sharePart = obj({share: {anyOf: [R, {type: 'null'}]}, matured: C});

const measured = obj({
  build: {type: 'string'},
  notMeasurable: {const: false},
  users: C,
  labUsers: C,
  events: {$ref: '#/$defs/eventCell'},
  activation: sharePart,
  retention: obj({
    secondDay: sharePart,
    d7: {anyOf: [sharePart, {type: 'null'}]},
    d28: {anyOf: [sharePart, {type: 'null'}]},
  }),
  pastSplash: {anyOf: [R, NI, {type: 'null'}]},
  anyValue: R,
  core: {
    type: 'array',
    items: obj({
      event: {type: 'string'},
      users: {anyOf: [C, NI]},
      events: {anyOf: [{$ref: '#/$defs/eventCell'}, NI]},
      reach: {anyOf: [R, NI]},
    }),
  },
  notInstrumented: {type: 'array', items: {type: 'string'}},
});
const notMeasurable = obj({
  build: {type: 'string'},
  notMeasurable: {const: true},
  users: {const: 0},
  labUsers: C,
});

export const schema = obj({
  definition: {type: 'string'},
  release: {type: ['string', 'null']},
  window: obj({
    from: {type: 'string'},
    to: {type: 'string'},
    days: {type: 'integer', minimum: 1},
    requestedDays: {type: 'integer', minimum: 1},
    retried: {type: 'boolean'},
  }),
  rolloutActive: {type: 'boolean'},
  verdict: {enum: ['OK', 'WARN', 'ALERT']},
  alertCount: {type: 'integer', minimum: 0},
  warnCount: {type: 'integer', minimum: 0},
  builds: {type: 'array', items: {anyOf: [measured, notMeasurable]}},
});

const n = v => Number(v) || 0;

/**
 * A share that the script gave as a fraction of `sample` → {share, matured}.
 * `fraction` null means "too few matured installs to judge".
 */
export function sharePartOf(fraction, sample) {
  const den = n(sample);
  if (
    fraction === null ||
    fraction === undefined ||
    !Number.isFinite(Number(fraction))
  )
    return {share: null, matured: cell(den)};
  return {
    share: rate(Math.round(Number(fraction) * den), den),
    matured: cell(den),
  };
}

// The retention fields that another change adds to rollout-engagement.mjs.
// undefined (the field is absent) → null; the sample name may be either form.
function optionalRetention(b, key) {
  if (!(key in b)) return null;
  return sharePartOf(
    b[key],
    b[`${key}Sample`] ?? b[`retentionSample${key.slice(9)}`],
  );
}

export function shapeBuild(b) {
  const build = String(b.build);
  if (b.notMeasurable)
    return {
      build,
      notMeasurable: true,
      users: 0,
      labUsers: cell(n(b.labUsers)),
    };
  const users = n(b.users);
  const steps = b.steps || [];
  const launched = steps.find(s => s.step === 'launched');
  const splash = steps.find(s => s.step === 'past_splash');
  let pastSplash = null;
  if (splash && !splash.instrumented) pastSplash = 'notInstrumented';
  else if (splash && launched)
    pastSplash = rate(n(splash.users), n(launched.users));
  return {
    build,
    notMeasurable: false,
    users: cell(users),
    labUsers: cell(n(b.labUsers)),
    events: eventCell(n(b.events), users),
    activation: sharePartOf(b.activation, b.activationSample),
    retention: {
      secondDay: sharePartOf(b.retention, b.retentionSample),
      d7: optionalRetention(b, 'retentionD7'),
      d28: optionalRetention(b, 'retentionD28'),
    },
    pastSplash,
    anyValue: rate(n(b.anyValueUsers), users),
    core: (b.core || []).map(c =>
      c.instrumented
        ? {
            event: String(c.event),
            users: cell(n(c.users)),
            events: eventCell(n(c.events), n(c.users)),
            reach: rate(n(c.users), users),
          }
        : {
            event: String(c.event),
            users: 'notInstrumented',
            events: 'notInstrumented',
            reach: 'notInstrumented',
          },
    ),
    notInstrumented: (b.notInstrumented || []).map(String),
  };
}

/**
 * The rollout-engagement JSON → the section data.
 * measuredAt = when the script ran; its window is the trailing `days` before it.
 */
export function shape(out, {measuredAt}) {
  const days = n(out.window?.days) || 30;
  const to = new Date(measuredAt);
  return {
    definition: DEFINITION,
    release: out.release ? String(out.release) : null,
    window: {
      from: new Date(to.getTime() - days * 86_400_000).toISOString(),
      to: to.toISOString(),
      days,
      requestedDays: n(out.window?.requestedDays) || n(out.window?.days) || 30,
      retried: !!out.window?.retried,
    },
    rolloutActive: !!out.rolloutActive,
    verdict: out.verdict,
    alertCount: (out.alerts || []).length,
    warnCount: (out.warns || []).length,
    builds: (out.builds || []).map(shapeBuild),
  };
}

export async function collect(ctx) {
  const source = 'scripts/rollout-engagement.mjs --json';
  const measuredAt = new Date().toISOString();
  const out = await ctx.runScript(SCRIPT);
  if (out.skipped) {
    // The script always exits 0 and says why it skipped. Its reason can hold
    // an API error text, so the section keeps a fixed text only.
    const reason = String(out.reason || '');
    const notConfigured = note => ({
      status: 'not_configured',
      source,
      data: null,
      notes: [note],
    });
    if (/unset/.test(reason))
      return notConfigured(
        'no PostHog key (POSTHOG_PERSONAL_API_TOKEN, POSTHOG_PROJECT_ID)',
      );
    if (/no `engagement` block/.test(reason))
      return notConfigured('active-rollout.json has no engagement block');
    return {
      status: 'error',
      source,
      data: null,
      error: 'rollout-engagement.mjs skipped the run: its PostHog query failed',
    };
  }
  const data = shape(out, {measuredAt});
  const notes = [];
  if (out.window?.retried)
    notes.push(
      `PostHog timed out; the window is ${out.window.days} days, not ${out.window.requestedDays}`,
    );
  if (data.builds.some(b => !b.notMeasurable && b.retention.d7 === null))
    notes.push('rollout-engagement.mjs sent no retentionD7 / retentionD28');
  return {status: 'ok', source, data, ...(notes.length ? {notes} : {})};
}
