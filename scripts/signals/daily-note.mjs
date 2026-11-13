#!/usr/bin/env node
// @ai
//
// scripts/signals/daily-note.mjs
// ------------------------------
// The daily health note (owner, 2026-11-10): one email at 06:00 in Los Angeles
// that says whether Qariah is healthy. Approved mock:
// https://claude.ai/artifact/11E1mk9eQkWfhUpP34JdRJ
//
// The subject alone answers "is everything healthy?". The body has two
// lights (Pipeline, Field), what needs the owner, DAU and WAU, the ramp, the
// field numbers and the builds. It uses no model.
//
// Inputs (the workflow `.github/workflows/daily-note.yml` makes them):
//   --status=<file>     the JSON of scripts/pipeline-status.mjs (needs you, the
//                       pipeline light, the builds, the investigate queue)
//   --snapshot=<file>   a fresh snapshot with the sections `active` and `health`
//                       (scripts/signals/snapshot.mjs --only=active,health)
//   --latest=<file>     the daily snapshot with the ANR numbers and the top
//                       crashes; without it the script reads snapshots/latest.json
//                       from the signals bucket (SIGNALS_R2_*)
//   --ramp=<file>       the output of `scripts/asc-phased-release.mjs status`
//   --issues=<file>     the issues of the last 24 hours (gh issue list --json
//                       number,title,labels,createdAt); without it the script asks gh
//   --schedule=<cron>   the cron of a scheduled run. GitHub cron has no time zone,
//                       so the workflow has two crons; the script sends only for
//                       the one that is 06:00 in Los Angeles today.
//   --print             print the subject and the text; send nothing
//   --html=<path>       write the HTML; send nothing
//
// Env for a send: SIGNALS_EMAIL_FROM, SIGNALS_SMTP_PASSWORD, DAILY_NOTE_TO
// (one or more addresses). Without DAILY_NOTE_TO the note goes to the first
// address of BRIEF_RECIPIENTS (the owner is first). A failed send exits 1.
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PLAY_BAD_BAR} from '../lib/anr-card.mjs';
import {curlConfig, message, recipients} from './email-digest.mjs';

export const SEND_HOUR_LA = 6;
export const CRASH_FREE_USER_BAR = 0.99;
// A release with this many users in 14 days is a store build for the light.
// A smaller one (a beta) shows in the table, but it does not change the light.
export const STORE_BUILD_MIN_USERS = 200;
export const PIPELINE_URL = 'https://qariah-ops-console.pages.dev/pipeline';
export const ENGAGEMENT_URL = 'https://qariah-ops-console.pages.dev/engagement';
const HOUR = 36e5;

const nf = new Intl.NumberFormat('en-US');
const n = v => (Number.isFinite(v) ? nf.format(v) : '—');
const pct = (v, d = 2) =>
  Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—';
const mmdd = iso => (iso ? String(iso).slice(5, 10) : '');

/** The hour in Los Angeles of a UTC instant. */
export function laHour(ms) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(ms)),
  );
}

/**
 * Does this scheduled run send? The workflow runs at 13:00 and 14:00 UTC; one
 * of the two is 06:00 in Los Angeles (summer and winter time). The test uses
 * the scheduled hour, not the start time, because GitHub starts a cron late.
 * No cron (a manual run) always sends.
 */
export function shouldSend(cron, nowMs = Date.now()) {
  if (!cron) return true;
  const m = /^\s*(\d+)\s+(\d+)\s/.exec(cron);
  if (!m) return true;
  const d = new Date(nowMs);
  const at = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    Number(m[2]),
    Number(m[1]),
  );
  return laHour(at) === SEND_HOUR_LA;
}

/** The two lines of `asc-phased-release.mjs status`. Missing parts are null. */
export function parseRamp(text) {
  const s = String(text || '');
  const ios = /iOS\s+version\s+(\S+)\s+state=(\S+)/.exec(s);
  const phased =
    /phased release:\s+(\S+)(?:\s+day=(\d+))?(?:\s+≈?(\d+(?:\.\d+)?)%)?/.exec(
      s,
    );
  const play =
    /Play\s+production:\s+vc\s*(\d+)\s+status=(\S+)\s+rollout=(\d+(?:\.\d+)?)%/.exec(
      s,
    );
  return {
    ios: ios
      ? {
          version: ios[1],
          state: ios[2],
          phased: phased ? phased[1] : null,
          day: phased && phased[2] ? Number(phased[2]) : null,
          percent: phased && phased[3] ? Number(phased[3]) : null,
        }
      : null,
    android: play
      ? {versionCode: play[1], status: play[2], percent: Number(play[3])}
      : null,
  };
}

const labelsOf = i =>
  (i.labels || []).map(l => (typeof l === 'string' ? l : l.name));
const numberOf = url => {
  const m = /\/(?:issues|pull)\/(\d+)/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
};
const sum = a => a.reduce((x, y) => x + y, 0);

/** Everything the note says, from the inputs. Pure: the tests call it. */
export function buildModel({status, snapshot, latest, ramp, issues, nowMs}) {
  const st = status || {};
  // Pipeline light.
  const pipeline = {
    level: st.overall?.level || 'UNKNOWN',
    reason: st.overall?.reason || 'The pipeline status is missing.',
  };

  // Needs you: the "now" items. A decision that asks for the same go as an
  // approval item is one item.
  const items = (st.needsYou?.items || []).filter(i => i.group === 'now');
  const approvals = items.filter(i => i.type === 'approve');
  const goBuilds = new Set(approvals.map(i => String(i.build)));
  const needs = [];
  for (const a of approvals) {
    const twin = items.find(
      i =>
        i.type === 'decision' &&
        new RegExp(`public beta ${a.build}\\b`).test(i.title || ''),
    );
    needs.push({
      text: `Public beta ${a.build} is READY. Reply on the Daily card:`,
      reply: a.reply,
      also: twin ? numberOf(twin.url) : null,
    });
  }
  for (const i of items) {
    if (i.type === 'approve') continue;
    if (
      i.type === 'decision' &&
      [...goBuilds].some(b =>
        new RegExp(`public beta ${b}\\b`).test(i.title || ''),
      )
    )
      continue;
    const num = numberOf(i.url);
    needs.push({
      text: `${num ? `#${num} ` : ''}${i.title}`,
      reply: i.replies?.length ? i.replies.map(r => r.text).join(' or ') : null,
    });
  }
  const reviews = (st.needsYou?.items || []).filter(i => i.type === 'review');
  if (reviews.length)
    needs.push({
      text: `${reviews.length} PR${
        reviews.length === 1 ? '' : 's'
      } wait for your review: ${reviews
        .map(r => `#${numberOf(r.url)}`)
        .join(', ')}.`,
    });

  // Users: the last full day of the fresh snapshot.
  const act = snapshot?.sections?.active;
  let users = null;
  if (act?.status === 'ok' || act?.status === 'partial') {
    const d = act.data;
    const last = d.days.length - 1;
    const dau = d.total.dau;
    const wau = d.total.wau;
    const week = dau
      .slice(Math.max(0, last - 6), last + 1)
      .filter(Number.isFinite);
    users = {
      date: d.days[last],
      dau: dau[last],
      ios: d.iOS?.dau?.[last] ?? null,
      android: d.Android?.dau?.[last] ?? null,
      avg7: week.length ? Math.round(sum(week) / week.length) : null,
      wau: wau[last],
      wauBefore: last >= 7 ? wau[last - 7] : null,
      wauBeforeDate: last >= 7 ? d.days[last - 7] : null,
    };
  }

  // Ramp: the live read of Apple and Play. Apple names the version only; the
  // rollout file of the status names its build.
  const r = ramp || {};
  const iosBuild =
    r.ios && st.rollout?.ios?.version === r.ios.version
      ? String(st.rollout.ios.build || '')
      : '';
  const rampRows = [];
  if (r.ios)
    rampRows.push({
      store: 'App Store',
      build: iosBuild ? `${r.ios.version} (${iosBuild})` : r.ios.version,
      percent:
        r.ios.phased === 'ACTIVE'
          ? r.ios.percent
          : r.ios.phased === 'COMPLETE'
            ? 100
            : null,
      state:
        r.ios.phased === 'ACTIVE'
          ? `Phased release, day ${r.ios.day} of 7. It goes up one step each day.`
          : r.ios.phased
            ? `Phased release ${r.ios.phased.toLowerCase()}, ${r.ios.state}.`
            : r.ios.state,
    });
  if (r.android)
    rampRows.push({
      store: 'Play',
      build: `vc${r.android.versionCode}`,
      percent: r.android.percent,
      state:
        r.android.status === 'completed'
          ? 'Complete.'
          : `Staged rollout, ${r.android.status}.`,
    });

  // Field: crash-free users of each release (fresh), ANR and the top crash (daily snapshot).
  const field = {reasons: []};
  const health = snapshot?.sections?.health;
  const rampCodes = new Set(
    [r.android?.versionCode, iosBuild].filter(Boolean).map(String),
  );
  const releases =
    health?.status === 'ok' || health?.status === 'partial'
      ? health.data.releases || []
      : [];
  const crash = releases
    .map(x => {
      const vc = String(x.versionCode);
      const store = x.users >= STORE_BUILD_MIN_USERS || rampCodes.has(vc);
      const name =
        String(x.release).replace(/^.*@/, '').replace('+', ' (') + ')';
      return {
        name,
        users: x.users,
        share: x.crashFreeUserShare,
        store,
        below:
          Number.isFinite(x.crashFreeUserShare) &&
          x.crashFreeUserShare < CRASH_FREE_USER_BAR,
      };
    })
    .filter(x => x.store || x.below)
    .sort((a, b) => b.users - a.users)
    .slice(0, 7);
  for (const c of crash)
    if (c.store && c.below)
      field.reasons.push(
        `${c.name} has ${pct(c.share)} crash-free users (bar 99%).`,
      );
  if (!releases.length) field.reasons.push('Sentry release health is missing.');

  const anrPlay = latest?.sections?.card?.data?.anr?.play || null;
  const anr = anrPlay
    ? {
        date: anrPlay.date,
        day: anrPlay.day,
        d7: anrPlay.d7,
        d28: anrPlay.d28,
        bar: PLAY_BAD_BAR,
        over: Number.isFinite(anrPlay.d7) && anrPlay.d7 > PLAY_BAD_BAR,
        users: anrPlay.dailyUsers ?? null,
      }
    : null;
  if (anr?.over)
    field.reasons.push(
      `Play ANR rate ${pct(anr.d7)} for 7 days. Play's bar is ${pct(anr.bar)}.`,
    );
  const top = latest?.sections?.card?.data?.crashes?.[0] || null;

  const since = nowMs - 24 * HOUR;
  const fresh = (issues || []).filter(i => Date.parse(i.createdAt) >= since);
  const newField = fresh.filter(i => labelsOf(i).includes('investigate'));
  const severe = fresh.filter(i => {
    const l = labelsOf(i);
    return l.includes('severity:critical') || l.includes('priority:P0');
  });
  if (severe.length)
    field.reasons.push(
      `${severe.length} new critical issue${
        severe.length === 1 ? '' : 's'
      } in 24 hours: ${severe.map(i => `#${i.number}`).join(', ')}.`,
    );
  field.level = field.reasons.length ? 'CHECK' : 'OK';

  const triage = (st.stages || []).find(s => s.key === 'triage');
  const investigateOpen =
    Number(/^(\d+) investigate/.exec(triage?.details?.[0] || '')?.[1]) || null;
  const audit = (st.stages || []).find(s => s.key === 'audit');
  const builds = {
    internal: st.builds?.internal?.[0] || null,
    public: st.builds?.public?.[0] || null,
    audit: audit?.details?.[0]?.replace(/^last verdict:\s*/, '') || null,
  };

  return {
    pipeline,
    field,
    needs,
    approvals: approvals.length,
    users,
    ramp: rampRows,
    crash,
    anr,
    top,
    newField,
    investigateOpen,
    builds,
    statusAt: st.computedAt || null,
  };
}

/** The subject: the lights first, then what waits, else the DAU. */
export function subjectOf(m) {
  const healthy = m.pipeline.level === 'GREEN' && m.field.level === 'OK';
  const head = healthy
    ? 'all healthy'
    : `field ${m.field.level} · pipeline ${
        m.pipeline.level === 'GREEN' ? 'OK' : m.pipeline.level
      }`;
  let tail;
  if (m.approvals === 1) tail = '1 go waits';
  else if (m.approvals > 1) tail = `${m.approvals} builds wait for your go`;
  else if (m.needs.length) tail = `${m.needs.length} need you`;
  else tail = m.users ? `DAU ${n(m.users.dau)}` : 'DAU —';
  return `Qariah: ${head} · ${tail}`;
}

const wauChange = u =>
  u && Number.isFinite(u.wauBefore) && u.wauBefore > 0
    ? Math.round(((u.wau - u.wauBefore) / u.wauBefore) * 100)
    : null;

export function renderText(m) {
  const L = [];
  L.push(
    `Pipeline: ${m.pipeline.level === 'GREEN' ? 'OK' : m.pipeline.level}. ${
      m.pipeline.reason
    }`,
  );
  L.push(
    `Field: ${m.field.level}.${
      m.field.reasons.length
        ? ` ${m.field.reasons.join(' ')}`
        : ' No field problem.'
    }`,
  );
  L.push('');
  L.push(`NEEDS YOU (${m.needs.length})`);
  if (!m.needs.length) L.push('  Nothing.');
  m.needs.forEach((x, i) =>
    L.push(
      `  ${i + 1}. ${x.text}${x.reply ? ` ${x.reply}` : ''}${
        x.also ? ` (#${x.also} asks the same.)` : ''
      }`,
    ),
  );
  L.push('');
  if (m.users) {
    const ch = wauChange(m.users);
    L.push(`USERS (${mmdd(m.users.date)})`);
    L.push(
      `  DAU ${n(m.users.dau)} (iOS ${n(m.users.ios)}, Android ${n(
        m.users.android,
      )}), 7-day average ${n(m.users.avg7)}`,
    );
    L.push(
      `  WAU ${n(m.users.wau)}${
        ch == null
          ? ''
          : `, ${ch >= 0 ? '+' : ''}${ch}% from ${n(
              m.users.wauBefore,
            )} on ${mmdd(m.users.wauBeforeDate)}`
      }`,
    );
  } else L.push('USERS: the PostHog numbers are missing.');
  L.push('');
  L.push('RAMP');
  if (!m.ramp.length) L.push('  The store read is missing.');
  for (const r of m.ramp)
    L.push(
      `  ${r.store} ${r.build}: ${r.percent == null ? '—' : `${r.percent}%`}. ${
        r.state
      }`,
    );
  L.push('');
  L.push('FIELD');
  for (const c of m.crash)
    L.push(
      `  ${c.name}: ${pct(c.share)} crash-free users, ${n(c.users)} users${
        c.below ? ' (below 99%)' : ''
      }`,
    );
  if (m.anr)
    L.push(
      `  Play ANR rate, all builds: ${pct(m.anr.day)} on ${mmdd(
        m.anr.date,
      )}, ${pct(m.anr.d7)} for 7 days, ${pct(
        m.anr.d28,
      )} for 28 days. Play's bar is ${pct(m.anr.bar)}.`,
    );
  if (m.top)
    L.push(
      `  Top Sentry issue: ${m.top.id} "${m.top.title}", ${n(
        m.top.users,
      )} users, builds ${(m.top.builds || []).join(', ')}.`,
    );
  L.push(
    `  New issues in 24 hours: ${m.newField.length}${
      m.newField.length
        ? ` (${m.newField.map(i => `#${i.number}`).join(', ')})`
        : ''
    }.${
      m.investigateOpen != null
        ? ` Investigate queue: ${m.investigateOpen} open.`
        : ''
    }`,
  );
  L.push('');
  L.push(`BUILDS: ${buildsLine(m)}`);
  L.push('');
  L.push(`Pipeline page: ${PIPELINE_URL}`);
  L.push(`Engagement page: ${ENGAGEMENT_URL}`);
  return L.join('\n');
}

function buildsLine(m) {
  const b = m.builds;
  const parts = [];
  if (b.internal)
    parts.push(`internal beta ${b.internal.build} (${mmdd(b.internal.at)})`);
  if (b.audit) parts.push(`audit: ${b.audit}`);
  if (b.public)
    parts.push(
      `public beta ${b.public.build} (${mmdd(b.public.at)}${
        b.public.by === 'hand' ? ', by hand' : ''
      })`,
    );
  return parts.join(' · ') || '—';
}

const esc = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c],
  );

const C = {
  ink: '#17212b',
  muted: '#5b6875',
  line: '#dde3e8',
  ok: '#1d7a46',
  okBg: '#e3f3ea',
  warn: '#9a5b00',
  warnBg: '#fbefd9',
  bad: '#b3261e',
  badBg: '#fbe4e2',
  code: '#eef2f4',
};

function light(label, level, why) {
  const good = level === 'OK' || level === 'GREEN';
  const fg = good ? C.ok : level === 'RED' ? C.bad : C.warn;
  const bg = good ? C.okBg : level === 'RED' ? C.badBg : C.warnBg;
  return `<td style="background:${bg};border-radius:10px;padding:10px 12px;vertical-align:top;width:50%">
<div style="font-size:12px;letter-spacing:.07em;text-transform:uppercase;font-weight:600;color:${fg}">${esc(
    label,
  )}</div>
<div style="font-size:17px;font-weight:700;color:${fg}">${esc(
    good ? 'OK' : level,
  )}</div>
<div style="font-size:13px;color:${C.ink}">${esc(why)}</div></td>`;
}

const h3 = t =>
  `<div style="font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:${
    C.muted
  };font-weight:600;margin:22px 0 8px">${esc(t)}</div>`;
const code = t =>
  `<code style="font-family:ui-monospace,Menlo,monospace;background:${
    C.code
  };padding:1px 5px;border-radius:4px">${esc(t)}</code>`;
const td = (t, right = false) =>
  `<td style="padding:6px 8px;border-bottom:1px solid ${C.line};${
    right ? 'text-align:right;' : ''
  }">${t}</td>`;
const th = (t, right = false) =>
  `<th style="padding:6px 8px;border-bottom:1px solid ${C.line};color:${
    C.muted
  };font-weight:600;font-size:12.5px;text-align:${
    right ? 'right' : 'left'
  }">${esc(t)}</th>`;

export function renderHtml(m) {
  const P = [];
  P.push(
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:${C.ink};max-width:620px">`,
  );
  P.push(
    `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>${light(
      'Pipeline',
      m.pipeline.level,
      m.pipeline.reason,
    )}${light(
      'Field',
      m.field.level,
      m.field.reasons.join(' ') || 'No field problem.',
    )}</tr></table>`,
  );
  P.push(h3(`Needs you (${m.needs.length})`));
  P.push(
    m.needs.length
      ? `<ol style="margin:0;padding-left:20px">${m.needs
          .map(
            x =>
              `<li style="margin-bottom:6px">${esc(x.text)}${
                x.reply ? ` ${code(x.reply)}` : ''
              }${x.also ? ` (#${x.also} asks the same.)` : ''}</li>`,
          )
          .join('')}</ol>`
      : '<p style="margin:0">Nothing.</p>',
  );
  if (m.users) {
    const ch = wauChange(m.users);
    P.push(h3(`Users (${mmdd(m.users.date)})`));
    P.push(
      `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>
<td style="border:1px solid ${
        C.line
      };border-radius:10px;padding:10px 12px;width:50%;vertical-align:top"><div style="font-size:12.5px;color:${
        C.muted
      }">DAU</div><div style="font-size:24px;font-weight:700">${n(
        m.users.dau,
      )}</div><div style="font-size:12.5px;color:${C.muted}">iOS ${n(
        m.users.ios,
      )} · Android ${n(m.users.android)} · 7-day average ${n(
        m.users.avg7,
      )}</div></td>
<td style="border:1px solid ${
        C.line
      };border-radius:10px;padding:10px 12px;width:50%;vertical-align:top"><div style="font-size:12.5px;color:${
        C.muted
      }">WAU</div><div style="font-size:24px;font-weight:700">${n(
        m.users.wau,
      )}</div><div style="font-size:12.5px;color:${C.muted}">${
        ch == null
          ? ''
          : `<span style="color:${ch >= 0 ? C.ok : C.bad};font-weight:600">${
              ch >= 0 ? '+' : ''
            }${ch}%</span> from ${n(m.users.wauBefore)} on ${mmdd(
              m.users.wauBeforeDate,
            )}`
      }</div></td></tr></table>`,
    );
  }
  P.push(h3('Ramp'));
  P.push(
    m.ramp.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13.5px"><tr>${th(
          'Store',
        )}${th('Build')}${th('Users', true)}${th('State')}</tr>${m.ramp
          .map(
            r =>
              `<tr>${td(esc(r.store))}${td(esc(r.build))}${td(
                r.percent == null ? '—' : `${r.percent}%`,
                true,
              )}${td(esc(r.state))}</tr>`,
          )
          .join('')}</table>`
      : '<p style="margin:0">The store read is missing.</p>',
  );
  P.push(h3('Field'));
  if (m.crash.length)
    P.push(
      `<table style="width:100%;border-collapse:collapse;font-size:13.5px"><tr>${th(
        'Build',
      )}${th('Users', true)}${th('Crash-free users', true)}</tr>${m.crash
        .map(
          c =>
            `<tr>${td(esc(c.name))}${td(n(c.users), true)}${td(
              `<span style="color:${c.below ? C.bad : C.ink};font-weight:${
                c.below ? 600 : 400
              }">${pct(c.share)}</span>`,
              true,
            )}</tr>`,
        )
        .join('')}</table>`,
    );
  const facts = [];
  if (m.anr)
    facts.push(
      `<strong>Play ANR rate, all builds:</strong> ${pct(m.anr.day)} on ${mmdd(
        m.anr.date,
      )}, ${pct(m.anr.d7)} for 7 days, ${pct(
        m.anr.d28,
      )} for 28 days. Play's bar is ${pct(m.anr.bar)}.${
        m.anr.over
          ? ` <span style="color:${C.warn};font-weight:600">Above the bar.</span>`
          : ''
      }`,
    );
  if (m.top)
    facts.push(
      `<strong>Top Sentry issue:</strong> ${esc(m.top.id)} "${esc(
        m.top.title,
      )}", ${n(m.top.users)} users, builds ${esc(
        (m.top.builds || []).join(', '),
      )}.`,
    );
  facts.push(
    `<strong>New issues in 24 hours:</strong> ${m.newField.length}${
      m.newField.length
        ? ` (${m.newField.map(i => `#${i.number}`).join(', ')})`
        : ''
    }.${
      m.investigateOpen != null
        ? ` Investigate queue: ${m.investigateOpen} open.`
        : ''
    }`,
  );
  P.push(
    `<ul style="margin:10px 0 0;padding-left:20px">${facts
      .map(f => `<li style="margin-bottom:6px">${f}</li>`)
      .join('')}</ul>`,
  );
  P.push(h3('Builds'));
  P.push(`<p style="margin:0">${esc(buildsLine(m))}</p>`);
  P.push(
    `<p style="margin:22px 0 0;padding-top:12px;border-top:1px solid ${
      C.line
    };font-size:13px;color:${
      C.muted
    }"><a href="${PIPELINE_URL}">Pipeline page</a> · <a href="${ENGAGEMENT_URL}">Engagement page</a><br>Crash-free users: Sentry, last 14 days. ANR: Play, users who share data with Google${
      m.anr?.users ? ` (about ${n(m.anr.users)} a day)` : ''
    }.</p>`,
  );
  P.push('</div>');
  return P.join('\n');
}

function readJson(path) {
  return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

async function latestFromBucket() {
  const {signalsBucket} = await import('./lib/bucket.mjs');
  const b = await signalsBucket(process.env);
  return b ? b.getJson('snapshots/latest.json') : null;
}

function issuesFromGh(nowMs) {
  const since = new Date(nowMs - 24 * HOUR).toISOString().slice(0, 19) + 'Z';
  const r = spawnSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      '200',
      '--search',
      `created:>=${since}`,
      '--json',
      'number,title,labels,createdAt',
    ],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
  );
  if (r.status !== 0) {
    console.log(
      `::warning::gh issue list failed: ${String(r.stderr)
        .trim()
        .slice(0, 200)}`,
    );
    return [];
  }
  return JSON.parse(r.stdout || '[]');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = k => {
    const hit = args.find(a => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : '';
  };
  const nowMs = Date.now();
  const cron = opt('schedule');
  if (!shouldSend(cron, nowMs)) {
    console.log(
      `::notice::Not 06:00 in Los Angeles for the cron "${cron}" today. No note.`,
    );
    return;
  }
  const status = readJson(opt('status'));
  const snapshot = readJson(opt('snapshot'));
  let latest = readJson(opt('latest'));
  if (!latest)
    latest = await latestFromBucket().catch(e => {
      console.log(
        `::warning::snapshots/latest.json not read: ${e?.message || e}`,
      );
      return null;
    });
  const ramp = parseRamp(opt('ramp') ? readFileSync(opt('ramp'), 'utf8') : '');
  const issues = opt('issues') ? readJson(opt('issues')) : issuesFromGh(nowMs);
  const m = buildModel({status, snapshot, latest, ramp, issues, nowMs});
  const subject = subjectOf(m);
  const text = renderText(m);
  const html = renderHtml(m);
  if (opt('html')) writeFileSync(opt('html'), html);
  if (args.includes('--print')) console.log(`Subject: ${subject}\n\n${text}`);
  if (opt('html') || args.includes('--print')) return;

  const from = process.env.SIGNALS_EMAIL_FROM;
  const password = process.env.SIGNALS_SMTP_PASSWORD;
  const to = recipients(process.env.DAILY_NOTE_TO).length
    ? recipients(process.env.DAILY_NOTE_TO)
    : recipients(process.env.BRIEF_RECIPIENTS).slice(0, 1);
  if (!from || !password || !to.length) {
    console.log(
      '::notice::Note not sent: set SIGNALS_EMAIL_FROM, SIGNALS_SMTP_PASSWORD and DAILY_NOTE_TO.',
    );
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'daily-note-'));
  const mail = join(dir, 'mail.eml');
  try {
    writeFileSync(mail, message({from, to, subject, text, html}));
    const r = spawnSync('curl', ['--config', '-', '--upload-file', mail], {
      input: curlConfig({from, password, to}),
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      // curl names the failure; its config (the password) is not in its output.
      console.error(
        `Note failed (curl ${r.status}): ${String(r.stderr)
          .trim()
          .slice(0, 300)}`,
      );
      process.exit(1);
    }
    console.log(`Note sent: "${subject}" to ${to.length} recipient(s).`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err => {
    console.error(`daily note failed: ${err?.message || err}`);
    process.exit(1);
  });
