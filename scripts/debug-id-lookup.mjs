#!/usr/bin/env node
// @ai
//
// scripts/debug-id-lookup.mjs — pivot a support report's Debug ID into evidence.
// ---------------------------------------------------------------------------
// The app prints an anonymous Debug ID in every Help & Support email
// (services/diagnostics/debugId.ts). The SAME id is the Sentry `debug_id` tag
// (app/_layout.tsx) and the PostHog distinct_id (services/analytics/
// AnalyticsService.ts). Until now nothing read it back. This script does: it
// asks Sentry and PostHog what that device did, and prints an `### Evidence`
// skeleton (scripts/lib/evidence-block.mjs) the investigate step can paste into
// the issue. READ-ONLY. Writes nothing anywhere.
//
// Usage:
//   set -a && source .env.local && set +a
//   node scripts/debug-id-lookup.mjs <uuid> [--around=<iso>] [--window=7d]
//                                    [--reported-build=1717] [--json]
//
//   --around=<iso>       centre the PostHog event window on the reporter's
//                        "when did it happen" (±12h); default = now − window
//   --window=7d|14d|30d  PostHog lookback when --around is absent (default 7d)
//   --reported-build=N   build number the reporter typed; flags a mismatch
//                        against the build telemetry actually saw ("please
//                        update" reply class)
//   --json               machine-readable output instead of the report
//
// Env (each side is optional; the script needs at least one):
//   SENTRY_READ_TOKEN, SENTRY_ORG (qariah), SENTRY_PROJECT (qariahv2),
//   SENTRY_REGION_HOST (https://de.sentry.io)
//   POSTHOG_PERSONAL_API_TOKEN, POSTHOG_PROJECT_ID, POSTHOG_HOST (https://us.posthog.com)
//
// Play vitals cannot pivot per user (aggregate API only) — stated, not attempted.
// Exit 0 always on a completed lookup (an empty result is a finding); exit 2 on
// usage/env errors.

import {renderSkeleton} from './lib/evidence-block.mjs';

const args = process.argv.slice(2);
const uuid = args.find(a => !a.startsWith('--'));
const opt = k => {
  const a = args.find(x => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : undefined;
};
const JSON_OUT = args.includes('--json');
const WINDOW = opt('window') || '7d';
const AROUND = opt('around');
const REPORTED_BUILD = opt('reported-build');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuid || !UUID_RE.test(uuid)) {
  console.error(
    'usage: debug-id-lookup.mjs <uuid> [--around=<iso>] [--window=7d] [--reported-build=N] [--json]',
  );
  process.exit(2);
}

const S = {
  token: process.env.SENTRY_READ_TOKEN,
  org: process.env.SENTRY_ORG || 'qariah',
  project: process.env.SENTRY_PROJECT || 'qariahv2',
  host: (process.env.SENTRY_REGION_HOST || 'https://de.sentry.io').replace(
    /\/$/,
    '',
  ),
};
const P = {
  token: process.env.POSTHOG_PERSONAL_API_TOKEN,
  project: process.env.POSTHOG_PROJECT_ID,
  host: (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(
    /\/$/,
    '',
  ),
};
if (!S.token && !(P.token && P.project)) {
  console.error(
    '❌ Need SENTRY_READ_TOKEN and/or POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID. Source .env.local.',
  );
  process.exit(2);
}

// Events that mean "something went wrong for this device" (services/analytics/
// events.ts + the Sentry captureMessage lanes). Substring match on purpose so a
// renamed event still surfaces; the human reads the sequence anyway.
const FAULT_RE =
  /(stall|killed|stopped|not_completed|failed|abandon|error|crash|timeout|dropped|pressure|skipped)/i;

async function sentry(path) {
  const res = await fetch(`${S.host}/api/0${path}`, {
    headers: {Authorization: `Bearer ${S.token}`},
  });
  if (!res.ok)
    throw new Error(
      `Sentry ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}
async function hogql(query) {
  const res = await fetch(`${P.host}/api/projects/${P.project}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${P.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({query: {kind: 'HogQLQuery', query}}),
  });
  if (!res.ok)
    throw new Error(
      `PostHog ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()).results || [];
}

async function lookupSentry() {
  if (!S.token) return {skipped: 'SENTRY_READ_TOKEN not set', issues: []};
  const q = encodeURIComponent(`debug_id:${uuid}`);
  const list = await sentry(
    `/projects/${S.org}/${S.project}/issues/?query=${q}&statsPeriod=14d&limit=25`,
  );
  const issues = [];
  for (const i of list) {
    let release = null;
    let device = null;
    try {
      const ev = await sentry(`/issues/${i.id}/events/latest/`);
      const tag = k => (ev.tags || []).find(t => t.key === k)?.value || null;
      release = tag('release');
      device = tag('device') || tag('device.model_id');
    } catch {
      /* latest event is optional */
    }
    issues.push({
      shortId: i.shortId,
      title: i.title,
      level: i.level,
      count: Number(i.count),
      users: Number(i.userCount),
      firstSeen: i.firstSeen,
      lastSeen: i.lastSeen,
      culprit: i.culprit,
      release,
      device,
      link: i.permalink,
    });
  }
  return {issues};
}

function windowClause() {
  if (AROUND) {
    const t = new Date(AROUND);
    if (Number.isNaN(t.getTime()))
      throw new Error(`--around is not an ISO date: ${AROUND}`);
    const lo = new Date(t.getTime() - 12 * 3600e3).toISOString();
    const hi = new Date(t.getTime() + 12 * 3600e3).toISOString();
    return `timestamp >= toDateTime('${lo}') AND timestamp <= toDateTime('${hi}')`;
  }
  const m = WINDOW.match(/^(\d+)d$/);
  const days = m ? Number(m[1]) : 7;
  return `timestamp > now() - interval ${days} day`;
}

async function lookupPostHog() {
  if (!(P.token && P.project))
    return {skipped: 'POSTHOG_* not set', events: [], person: null};
  const id = uuid.replace(/'/g, '');
  const rows = await hogql(
    `SELECT event, timestamp, properties.$app_build, properties.$app_version, properties.$os, properties.$os_version, properties.$device_model
     FROM events WHERE distinct_id = '${id}' AND ${windowClause()} ORDER BY timestamp ASC LIMIT 400`,
  );
  const events = rows.map(r => ({
    event: r[0],
    ts: r[1],
    build: r[2] ? String(r[2]) : null,
    version: r[3] ? String(r[3]) : null,
    os: [r[4], r[5]].filter(Boolean).join(' ') || null,
    model: r[6] || null,
    fault: FAULT_RE.test(String(r[0])),
  }));
  const last = events[events.length - 1] || null;
  const person = last
    ? {
        build: last.build,
        version: last.version,
        os: last.os,
        model: last.model,
        lastSeen: last.ts,
      }
    : null;
  return {events, person};
}

function buildRange(vals) {
  const nums = vals
    .map(v => Number(String(v || '').match(/\d{3,5}/)?.[0]))
    .filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

(async () => {
  const [se, ph] = await Promise.all([lookupSentry(), lookupPostHog()]);

  const faults = ph.events.filter(e => e.fault);
  const seenBuilds = [
    ...se.issues.map(i => i.release),
    ...ph.events.map(e => e.build),
  ].filter(Boolean);
  const builds = buildRange(seenBuilds);
  const telemetryBuild =
    ph.person?.build ||
    (se.issues[0]?.release || '').match(/\d{3,5}/)?.[0] ||
    null;
  const mismatch =
    REPORTED_BUILD &&
    telemetryBuild &&
    String(REPORTED_BUILD) !== String(telemetryBuild)
      ? {reported: REPORTED_BUILD, telemetry: telemetryBuild}
      : null;

  const platform = /ios|iphone|ipad/i.test(
    ph.person?.os || se.issues[0]?.device || '',
  )
    ? 'ios'
    : /android/i.test(ph.person?.os || '')
      ? 'android'
      : null;

  // Evidence skeleton — only the fields telemetry can fill; the rest stay <fill>.
  const top = se.issues[0];
  const sentryLine = top
    ? `${top.shortId} (${top.count} events / ${top.users} users, release ${top.release || '?'}; ${top.title.slice(0, 80)})`
    : undefined;
  const seq = faults.slice(-4).map(e => e.event);
  const posthogLine = seq.length
    ? `distinct_id ${uuid} — ${seq.join(' → ')} (${faults[faults.length - 1].ts})`
    : undefined;
  const skeleton = renderSkeleton({
    platform: platform || undefined,
    builds: builds || undefined,
    signature: top?.culprit || undefined,
    sentry: sentryLine,
    posthog: posthogLine,
  });

  const out = {
    debugId: uuid,
    sentry: se,
    posthog: {
      skipped: ph.skipped,
      person: ph.person,
      eventCount: ph.events.length,
      faults,
    },
    playVitals: 'cannot pivot per device — aggregate API only',
    telemetryBuild,
    reportedBuild: REPORTED_BUILD || null,
    buildMismatch: mismatch,
    evidenceSkeleton: skeleton,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`# Debug ID ${uuid}\n`);
  console.log('## Sentry');
  if (se.skipped) console.log(`  skipped — ${se.skipped}`);
  else if (!se.issues.length)
    console.log('  no issues carry debug_id=<this id> in the last 90 days');
  for (const i of se.issues)
    console.log(
      `  ${i.shortId}  ${i.level}  ${i.count} events / ${i.users} users  ${i.firstSeen?.slice(0, 10)}→${i.lastSeen?.slice(0, 10)}  release=${i.release || '?'}  ${i.title}`,
    );
  console.log('\n## PostHog');
  if (ph.skipped) console.log(`  skipped — ${ph.skipped}`);
  else {
    console.log(
      `  ${ph.events.length} events in window; last seen ${ph.person?.lastSeen || '—'} on ${ph.person?.model || '?'} ${ph.person?.os || ''} build ${ph.person?.build || '?'}`,
    );
    if (!faults.length) console.log('  no fault-shaped events in window');
    for (const e of faults.slice(-12))
      console.log(`  ${e.ts}  ${e.event}  build=${e.build || '?'}`);
  }
  console.log(
    '\n## Play vitals\n  cannot pivot per device (aggregate API only)',
  );
  if (mismatch)
    console.log(
      `\n⚠️  BUILD MISMATCH — reporter says ${mismatch.reported}, telemetry last saw ${mismatch.telemetry}. Reply class: "please update, then retry".`,
    );
  console.log(
    '\n## Evidence skeleton (paste into the issue, fill the <fill> fields)\n',
  );
  console.log(skeleton);
})().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
