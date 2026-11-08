#!/usr/bin/env node
// @ai
//
// scripts/signals/email-digest.mjs
// --------------------------------
// The weekly email of the Engagement page's Overview numbers (owner,
// 2026-11-01): five weeks of each number with small bars, on Sunday early in
// the morning in Los Angeles (`.github/workflows/signals-weekly-email.yml`).
// It reads the sections of a snapshot file and asks PostHog for the people on
// each build and the journey of each week. Neither is in the file by week. A
// section without data prints "—" with its status. It goes through Google's
// mail server with curl.
//
//   node scripts/signals/email-digest.mjs --print        # print; send nothing
//   node scripts/signals/email-digest.mjs --html=<path>  # write the HTML; send nothing
//   node scripts/signals/email-digest.mjs                # send
//   node scripts/signals/email-digest.mjs --file=<snapshot.json>
//
// Env: POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID, SIGNALS_EMAIL_FROM (the
// account that sends), SIGNALS_SMTP_PASSWORD (its app password),
// SIGNALS_EMAIL_TO (one or more addresses, comma-separated). Without the mail
// values it prints a notice and exits 0. A failed send exits 1, so the job
// turns red.

// The repo's eslint config declares no Node globals; this is a Node builtin.
/* global Buffer */
import {spawnSync} from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PLAY_BAD_BAR, scorePct} from '../lib/anr-card.mjs';
import {makeContext, scrub} from './lib/context.mjs';
import {addDays, cell} from './lib/rules.mjs';
import {
  JOURNEY,
  ROW_LIMIT,
  buildsQuery,
  groupsQuery,
} from './sections/journey-by-build.mjs';

export const PAGE_URL = 'https://qariah-ops-console.pages.dev/engagement';
const SMTP_URL = 'smtps://smtp.gmail.com:465';
export const WEEKS = 5;
/** Owner 2026-10-30: a build with more people than this has its own row. */
export const BUILD_MIN_PEOPLE = 50;

/**
 * Days with missing PostHog events. A week that holds one of these days is
 * marked, and the note prints until the week leaves the email. Add a new gap
 * here when it happens.
 */
export const DATA_GAPS = [
  {
    from: '2026-10-28',
    to: '2026-10-31',
    note: 'PostHog stopped taking events from Oct 28 to Oct 31 (the free limit). The week is low for that reason, and it does not show a real drop. Only v1 listens and Google’s score are complete that week.',
  },
];

/** A count of the file: 1,234, "<5" stays text, anything else is "—". */
export function fmt(v) {
  if (typeof v === 'number' && Number.isFinite(v))
    return v.toLocaleString('en-US');
  return v === '<5' ? '<5' : '—';
}

const dataOf = (snap, name) => {
  const s = snap.sections?.[name];
  return s && (s.status === 'ok' || s.status === 'partial') ? s.data : null;
};
const missing = (snap, name) =>
  `— (${snap.sections?.[name]?.status ?? 'not in this file'})`;
const sum = values =>
  values.reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);

/** The last WEEKS blocks of 7 days that end at dataThrough, oldest first. */
export function weeksTo(dataThrough) {
  return Array.from({length: WEEKS}, (_, i) => {
    const to = addDays(dataThrough, -7 * (WEEKS - 1 - i));
    return {from: addDays(to, -6), to};
  });
}

const inWeek = (days, {from, to}) =>
  (days ?? []).flatMap((d, i) => (d >= from && d <= to ? [i] : []));
const weekSums = (weeks, days, values) =>
  weeks.map(w => sum(inWeek(days, w).map(i => values?.[i])));
const shortDay = d =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The people on each build and the journey, for each week. Each week is two
 * queries, so a group row counts each install once. → {weeks: [{builds, all,
 * other}], rows, otherBuilds, journey}.
 */
export async function collectByBuild(ctx, weeks) {
  const KEYS = JOURNEY.map(s => s.key);
  const perWeek = [];
  for (const w of weeks)
    perWeek.push(
      await ctx.hogql(buildsQuery(w.from, w.to, ctx.asOfSQL), {
        limit: ROW_LIMIT,
      }),
    );
  const builds = new Map();
  perWeek.forEach((rows, wi) => {
    for (const [plat, build, version, installs] of rows) {
      const key = `${plat}-${build}`;
      if (!builds.has(key))
        builds.set(key, {
          key,
          platform: plat,
          build: String(build),
          version: String(version ?? ''),
          people: Array(weeks.length).fill(0),
        });
      builds.get(key).people[wi] = Number(installs) || 0;
    }
  });
  const big = b => Math.max(...b.people) > BUILD_MIN_PEOPLE;
  const own = [...builds.values()]
    .filter(big)
    .sort(
      (a, b) =>
        b.people.at(-1) - a.people.at(-1) ||
        Math.max(...b.people) - Math.max(...a.people),
    );
  const otherKeys = [...builds.values()].filter(b => !big(b)).map(b => b.key);
  const other = [];
  const journey = Object.fromEntries(KEYS.map(k => [k, []]));
  for (const w of weeks) {
    const rows = await ctx.hogql(
      groupsQuery(w.from, w.to, {other: otherKeys}, ctx.asOfSQL),
      {limit: 10},
    );
    const row = g => rows.find(r => String(r[0]) === g);
    other.push(cell(Number(row('other')?.[1]) || 0));
    KEYS.forEach((k, i) =>
      journey[k].push(cell(Number(row('all')?.[i + 2]) || 0)),
    );
  }
  return {
    rows: own.map(b => ({...b, people: b.people.map(cell)})),
    otherBuilds: otherKeys.length,
    other,
    journey,
  };
}

/** The rows of the email as data, so the HTML and the text say the same thing. */
function model(snap, byBuild) {
  const weeks = weeksTo(snap.dataThrough);
  const gaps = DATA_GAPS.filter(g =>
    weeks.some(w => g.from <= w.to && g.to >= w.from),
  );
  const hasGap = weeks.map(w =>
    gaps.some(g => g.from <= w.to && g.to >= w.from),
  );
  const groups = [];

  const active = dataOf(snap, 'active');
  const warnings = [];
  if (active) {
    const at = k =>
      weeks.map(w => active.total?.[k]?.[active.days.indexOf(w.to)]);
    const dau = weeks.map(w => {
      const v = inWeek(active.days, w)
        .map(i => active.total?.dau?.[i])
        .filter(n => typeof n === 'number');
      return v.length ? Math.round(sum(v) / v.length) : null;
    });
    groups.push({
      title: 'ACTIVE (people)',
      rows: [
        {label: 'Daily', sub: 'average of the week', values: dau},
        {label: 'Weekly', sub: 'on the last day', values: at('wau')},
        {label: 'Monthly', sub: 'on the last day', values: at('mau')},
      ],
    });
    // PostHog drops every event after its monthly limit (2026-10-29).
    if (
      inWeek(active.days, weeks.at(-1)).some(i => active.total?.dau?.[i] === 0)
    )
      warnings.push(
        'WARNING: a day had 0 people. Check the PostHog event limit.',
      );
  } else groups.push({title: 'ACTIVE (people)', status: missing(snap, 'active')});

  const listens = dataOf(snap, 'listens');
  let totalListens = null;
  let listenWeeks = null;
  if (Array.isArray(listens?.total?.v2)) {
    const v1 = weekSums(weeks, listens.days, listens.total.v1);
    const v2 = weekSums(weeks, listens.days, listens.total.v2);
    listenWeeks = v1.map((n, i) => n + v2[i]);
    // Only exact counts add up; a "<5" day adds nothing.
    totalListens =
      (typeof listens.v1Before?.plays === 'number'
        ? listens.v1Before.plays
        : 0) +
      sum([listens.cumulative?.v1?.at(-1), listens.cumulative?.v2?.at(-1)]);
    groups.push({
      title: 'LISTENS (plays started)',
      rows: [
        {label: 'All listens', values: listenWeeks},
        {label: 'v1 app', values: v1, complete: true},
        {label: 'v2 app', values: v2},
      ],
    });
  } else groups.push({title: 'LISTENS (plays started)', status: missing(snap, 'listens')});

  if (byBuild?.rows) {
    const rows = byBuild.rows.map(b => ({
      label: `${b.platform} ${b.build}`,
      sub: b.version,
      values: b.people,
    }));
    if (byBuild.otherBuilds)
      rows.push({
        label: `${byBuild.otherBuilds} other builds`,
        values: byBuild.other,
      });
    groups.push({title: 'BUILDS (people)', rows});
    groups.push({
      title: 'JOURNEY (people)',
      rows: JOURNEY.map(s => ({
        label: s.label,
        values: byBuild.journey[s.key],
      })),
    });
  } else {
    const status = `— (${byBuild?.error ?? 'not run'})`;
    groups.push({title: 'BUILDS (people)', status});
    groups.push({title: 'JOURNEY (people)', status});
  }

  const use = dataOf(snap, 'use');
  if (use?.daily) {
    const row = (label, key) => ({
      label,
      values: weekSums(weeks, use.days, use.daily[key]?.events),
    });
    groups.push({
      title: 'USE (events)',
      rows: [
        row('Heard properly', 'meaningful_listen'),
        row('Finished', 'playback_completed'),
        row('Mushaf pages', 'mushaf_page_read'),
      ],
    });
  } else groups.push({title: 'USE (events)', status: missing(snap, 'use')});

  const focus = dataOf(snap, 'focus');
  if (focus?.focus) {
    const title = `FOCUS: ${focus.focus.title}`;
    const daily = focus.metric?.daily;
    if (Array.isArray(daily)) {
      const score = weeks.map(w => {
        const v = daily
          .filter(d => d.date >= w.from && d.date <= w.to)
          .map(d => d.rate)
          .filter(r => typeof r === 'number');
        return v.length ? sum(v) / v.length : null;
      });
      const now =
        typeof focus.metric.d28 === 'number'
          ? `; now ${scorePct(focus.metric.d28)} (28 days)`
          : '';
      groups.push({
        title,
        rows: [
          {
            label: 'Google’s score',
            sub: `average of the days; limit ${scorePct(PLAY_BAD_BAR)}${now}`,
            values: score,
            format: v => (typeof v === 'number' ? scorePct(v) : '—'),
            complete: true,
          },
        ],
      });
    } else groups.push({title, rows: []});
  } else groups.push({title: 'FOCUS', status: missing(snap, 'focus')});

  const notOk = Object.entries(snap.sections ?? {})
    .filter(([k, s]) => {
      // This job does not run `card`, so `focus` is always partial here: it
      // has no frozeWeek, and the email does not use that field.
      if (k === 'focus' && s.status === 'partial') return false;
      return s.status !== 'ok' && s.status !== 'pending';
    })
    .map(([k, s]) => `${k} (${s.status})`);

  const newest = groups
    .find(g => g.title === 'ACTIVE (people)')
    ?.rows?.find(r => r.label === 'Weekly')
    ?.values?.at(-1);
  const head = [];
  if (typeof newest === 'number') head.push(`${fmt(newest)} weekly active`);
  if (listenWeeks) head.push(`${fmt(listenWeeks.at(-1))} listens`);
  return {
    weeks,
    hasGap,
    gaps,
    groups,
    warnings,
    notOk,
    totalListens,
    subject: ['Qariah weekly', ...head].join(' · '),
  };
}

function renderText(m, dataThrough) {
  const L = [
    `Five weeks, each 7 days. Data through ${dataThrough}.`,
    `Each line: ${m.weeks.map((w, i) => `${shortDay(w.from)}${m.hasGap[i] ? '*' : ''}`).join(' · ')}`,
  ];
  if (m.totalListens !== null)
    L.push(`${fmt(m.totalListens)} listens since launch`);
  for (const g of m.gaps) L.push('', `* ${g.note}`);
  if (m.warnings.length) L.push('', ...m.warnings);
  for (const g of m.groups) {
    L.push('', g.title);
    if (g.status) L.push(`  ${g.status}`);
    for (const r of g.rows ?? [])
      L.push(`  ${r.label}: ${r.values.map(r.format ?? fmt).join(' · ')}`);
  }
  if (m.notOk.length) L.push('', `Sections not ok: ${m.notOk.join(', ')}`);
  L.push('', `Open the page: ${PAGE_URL}`);
  return `${L.join('\n')}\n`;
}

const esc = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const INK = '#1f2a26';
const MUTED = '#5f6b66';
const LINE = '#e3e8e5';
const BAR = '#2f7d6b';
const BAR_GAP = '#b9c7c1';

/** Small bars as table cells: Gmail removes SVG. */
function barsHtml(values, hasGap) {
  const max = Math.max(...values.map(v => (typeof v === 'number' ? v : 0)), 1);
  const cells = values.map((v, i) => {
    const h = Math.max(
      2,
      Math.round(((typeof v === 'number' ? v : 0) / max) * 20),
    );
    return `<td valign="bottom" height="20" style="height:20px;padding:0 2px 0 0;vertical-align:bottom"><div style="width:9px;height:${h}px;line-height:${h}px;font-size:1px;background:${hasGap[i] ? BAR_GAP : BAR};border-radius:2px 2px 0 0">&nbsp;</div></td>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px"><tr>${cells.join('')}</tr></table>`;
}

function renderHtml(m, dataThrough) {
  const noGap = m.hasGap.map(() => false);
  const row = r => {
    const hasGap = r.complete ? noGap : m.hasGap;
    const f = r.format ?? fmt;
    const sub = r.sub
      ? `<div style="font-size:11px;color:${MUTED}">${esc(r.sub)}</div>`
      : '';
    const nums = r.values.map(
      (v, i) =>
        `<td align="right" style="padding:8px 0 8px 6px;border-top:1px solid ${LINE};font-size:12px;white-space:nowrap;color:${hasGap[i] ? MUTED : INK}">${esc(f(v))}</td>`,
    );
    return `<tr><td style="padding:8px 6px 8px 0;border-top:1px solid ${LINE};font-size:13px;color:${INK}">${esc(r.label)}${sub}${barsHtml(r.values, hasGap)}</td>${nums.join('')}</tr>`;
  };
  const span = WEEKS + 1;
  const body = m.groups.flatMap(g => [
    `<tr><td colspan="${span}" style="padding:18px 0 4px;font-size:12px;font-weight:700;color:${INK}">${esc(g.title)}</td></tr>`,
    ...(g.status
      ? [
          `<tr><td colspan="${span}" style="padding:8px 0;border-top:1px solid ${LINE};font-size:12px;color:${MUTED}">${esc(g.status)}</td></tr>`,
        ]
      : []),
    ...(g.rows ?? []).map(row),
  ]);
  const cols = m.weeks.map(
    (w, i) =>
      `<th align="right" style="padding:0 0 6px 6px;font-size:11px;font-weight:600;color:${MUTED};white-space:nowrap">${shortDay(w.from)}${m.hasGap[i] ? '*' : ''}</th>`,
  );
  const box = text =>
    `<div style="font-size:12px;color:${INK};background:#f4f6f5;border-radius:6px;padding:8px 10px;margin-top:12px">${esc(text)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:16px;box-sizing:border-box">
<div style="background:#fff;border:1px solid ${LINE};border-radius:8px;padding:16px">
<div style="font-size:18px;font-weight:700;color:${INK}">Qariah weekly</div>
<div style="font-size:12px;color:${MUTED};margin-top:2px">Five weeks, each 7 days from the date in the column. Data through ${shortDay(dataThrough)}.</div>
${m.totalListens !== null ? `<div style="font-size:13px;color:${INK};margin-top:12px"><b>${fmt(m.totalListens)}</b> listens since launch</div>` : ''}
${m.gaps.map(g => box(`* ${g.note}`)).join('\n')}
${m.warnings.map(box).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:14px">
<tr><th></th>${cols.join('')}</tr>
${body.join('\n')}
</table>
${m.notOk.length ? `<div style="font-size:12px;color:${MUTED};margin-top:12px">Sections not ok: ${esc(m.notOk.join(', '))}</div>` : ''}
<div style="font-size:12px;margin-top:16px"><a href="${PAGE_URL}" style="color:${BAR}">Open the page</a></div>
</div></div></body></html>
`;
}

/** The snapshot and the by-build numbers → {subject, text, html}. */
export function digest(snap, byBuild) {
  const m = model(snap, byBuild);
  return {
    subject: m.subject,
    text: renderText(m, snap.dataThrough),
    html: renderHtml(m, snap.dataThrough),
  };
}

/** The addresses of SIGNALS_EMAIL_TO. */
export const recipients = s =>
  String(s || '')
    .split(/[,;\s]+/)
    .filter(Boolean);

const base64Lines = s =>
  Buffer.from(s)
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

/** The message for curl: the text and the HTML, with CRLF line ends. The subject is UTF-8 (RFC 2047). */
export function message({from, to, subject, text, html, date = new Date()}) {
  const encoded = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const boundary = 'qariah-weekly-part';
  const part = (type, content) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(content),
  ];
  return [
    `From: Qariah metrics <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${encoded}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    ...part('text/plain', text),
    ...part('text/html', html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/**
 * The curl config: it goes in on stdin, so the password is not in the process
 * list. A quote or a backslash in the password is escaped.
 */
export function curlConfig({from, password, to}) {
  const q = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return [
    `url = ${q(SMTP_URL)}`,
    'ssl-reqd',
    `user = ${q(`${from}:${password}`)}`,
    `mail-from = ${q(from)}`,
    ...to.map(t => `mail-rcpt = ${q(t)}`),
    'silent',
    'show-error',
    'max-time = 60',
    '',
  ].join('\n');
}

function newestSnapshot(dir = 'build/signals') {
  const names = readdirSync(dir)
    .filter(n => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();
  if (!names.length) throw new Error(`no snapshot file in ${dir}`);
  return resolve(dir, names.at(-1));
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => a.startsWith('--file='));
  const htmlArg = args.find(a => a.startsWith('--html='));
  const file = fileArg ? fileArg.slice(7) : newestSnapshot();
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  const ctx = makeContext({date: snap.date});
  // A failed query does not stop the email: the two groups print the status.
  const byBuild = await collectByBuild(ctx, weeksTo(snap.dataThrough)).catch(
    e => {
      console.log(
        `::warning::by-build numbers failed: ${scrub(e?.message || e)}`,
      );
      return {error: 'error'};
    },
  );
  const {subject, text, html} = digest(snap, byBuild);
  if (htmlArg) writeFileSync(htmlArg.slice(7), html);
  if (args.includes('--print')) console.log(`Subject: ${subject}\n\n${text}`);
  if (htmlArg || args.includes('--print')) return;
  const from = process.env.SIGNALS_EMAIL_FROM;
  const password = process.env.SIGNALS_SMTP_PASSWORD;
  const to = recipients(process.env.SIGNALS_EMAIL_TO);
  if (!from || !password || !to.length) {
    console.log(
      '::notice::Email not sent: set SIGNALS_EMAIL_FROM, SIGNALS_SMTP_PASSWORD and SIGNALS_EMAIL_TO.',
    );
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'signals-email-'));
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
        `Email failed (curl ${r.status}): ${String(r.stderr).trim().slice(0, 300)}`,
      );
      process.exit(1);
    }
    console.log(`Email sent: "${subject}" to ${to.length} recipient(s).`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err => {
    console.error(`email failed: ${scrub(err?.message || err)}`);
    process.exit(1);
  });
