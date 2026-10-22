#!/usr/bin/env node
// @ai
//
// scripts/signals/check.mjs
// -------------------------
// Signals plan, Phase 1 exit check (planning/signals-phase1-design.md, "The
// card match"). For one LA date it:
//   1. reads that day's snapshot and runs the snapshot checks (schema, small
//      cells, size, required sections);
//   2. finds that day's Daily card comment on the "Daily card" issue and
//      compares its people line, journey, ACTIVE and USE with the snapshot's
//      `card` section;
//   3. writes checks/<date>.json (bucket with --upload, else build/signals/).
// `--streak` counts the days in a row, up to the newest check, that are valid
// AND match. Phase 1 is done when the streak reaches 7.
//
//   node scripts/signals/check.mjs --date=2026-10-19 [--file=<snapshot.json>] [--upload] [--allow-missing]
//   node scripts/signals/check.mjs --streak [--days=30]
//
// The card runs about 40 minutes after the snapshot and counts trailing
// windows, so a value matches when |snapshot − card| <= max(5, 3% of card).
// A snapshot "<5" matches a card value from 1 to 4.
//
// Exit 1 when the snapshot is missing or fails its checks. A mismatch or a
// missing card prints ::warning:: and exits 0: the streak records it.
// `--allow-missing` (the workflow uses it) records a missing snapshot as an
// invalid day with a warning and exits 0, so the first day after the merge,
// which has no snapshot for yesterday, does not turn the run red.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {basename, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {judge} from './snapshot.mjs';
import {ROOT, scrub} from './lib/context.mjs';
import {signalsBucket} from './lib/bucket.mjs';
import {addDays, laDate, SMALL} from './lib/rules.mjs';
import {DAILY_CARD_TITLE, GH_REPO, ghApi} from '../lib/triage-common.mjs';

const LOCAL_DIR = resolve(ROOT, 'build/signals');

// ---------------------------------------------------------------------------
// Parse a posted card. The text is the ```text block of the comment.
// ---------------------------------------------------------------------------

const JOURNEY = [
  'Opened',
  'Past loading',
  'Logged in',
  'Started',
  'Really used',
];
const ACTIVE_ROWS = ['Today', 'Yesterday', 'Day before'];
const USE_ROWS = ['Recitations', 'Heard properly', 'Finished', 'Mushaf pages'];

/** The card text inside a Daily card comment, or null. */
export function cardText(body) {
  const m = String(body || '').match(/```text\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

const num = s => Number(String(s).replace(/,/g, ''));
const rowRe = label =>
  new RegExp(
    `^\\s*${label.replace(/ /g, '\\s')}\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s*$`,
    'm',
  );

/** The numbers of a card: {people, journey, active, usage}. Absent parts are null. */
export function parseCard(text) {
  if (!text) return null;
  const p = text.match(/^([\d,]+) people · iOS ([\d,]+) · Android ([\d,]+)/m);
  const inst = text.match(/^\s+([\d,]+) of them installed or updated it/m);
  const journey = {};
  for (const label of JOURNEY) {
    const m = text.match(new RegExp(`^${label}\\s+([\\d,]+)\\s*$`, 'm'));
    if (m) journey[label] = num(m[1]);
  }
  const table = labels => {
    const out = {};
    for (const label of labels) {
      const m = text.match(rowRe(label));
      if (m) out[label] = [num(m[1]), num(m[2]), num(m[3])];
    }
    return Object.keys(out).length ? out : null;
  };
  return {
    people: p
      ? {
          total: num(p[1]),
          iOS: num(p[2]),
          Android: num(p[3]),
          installed: inst ? num(inst[1]) : null,
        }
      : null,
    journey: Object.keys(journey).length ? journey : null,
    active: table(ACTIVE_ROWS),
    usage: table(USE_ROWS),
  };
}

// ---------------------------------------------------------------------------
// Compare.
// ---------------------------------------------------------------------------

/** True when a snapshot value matches a card value (see the header). */
export function close(snap, card) {
  if (card === null || card === undefined) return true; // the card does not print it
  if (snap === SMALL) return card >= 1 && card <= 4;
  if (typeof snap !== 'number') return false;
  return Math.abs(snap - card) <= Math.max(5, 0.03 * card);
}

/**
 * Compare the parsed card with the snapshot's card section.
 * Returns {match, diffs: [{field, snapshot, card}], compared}.
 */
export function compareCard(parsed, data) {
  const diffs = [];
  let compared = 0;
  const cmp = (field, snap, card) => {
    if (card === null || card === undefined) return;
    compared++;
    if (!close(snap, card)) diffs.push({field, snapshot: snap ?? null, card});
  };
  if (parsed.people) {
    const pp = data?.people || {};
    for (const k of ['total', 'iOS', 'Android', 'installed'])
      cmp(`people.${k}`, pp[k], parsed.people[k]);
  }
  if (parsed.journey) {
    const byLabel = Object.fromEntries(
      (data?.journey || []).filter(Boolean).map(s => [s.label, s.installs]),
    );
    for (const [label, n] of Object.entries(parsed.journey))
      cmp(`journey.${label}`, byLabel[label], n);
  }
  if (parsed.active) {
    const byLabel = Object.fromEntries(
      (data?.active || []).filter(Boolean).map(r => [r.label, r]),
    );
    for (const [label, [dau, wau, mau]] of Object.entries(parsed.active)) {
      const r = byLabel[label] || {};
      cmp(`active.${label}.dau`, r.dau, dau);
      cmp(`active.${label}.wau`, r.wau, wau);
      cmp(`active.${label}.mau`, r.mau, mau);
    }
  }
  if (parsed.usage) {
    const byLabel = Object.fromEntries(
      (data?.usage || []).filter(Boolean).map(r => [r.label, r]),
    );
    for (const [label, [day, week, month]] of Object.entries(parsed.usage)) {
      const r = byLabel[label] || {};
      cmp(`usage.${label}.day`, r.day, day);
      cmp(`usage.${label}.week`, r.week, week);
      cmp(`usage.${label}.month`, r.month, month);
    }
  }
  return {match: compared > 0 && diffs.length === 0, diffs, compared};
}

/** Minutes from the snapshot to the card, or null. */
export function lagMinutes(snapshotAt, cardAt) {
  const a = Date.parse(snapshotAt || ''),
    b = Date.parse(cardAt || '');
  return Number.isFinite(a) && Number.isFinite(b)
    ? Math.round((b - a) / 60000)
    : null;
}

/** Days in a row, ending at the newest check, that are valid and match. */
export function streak(checks) {
  const byDate = new Map(checks.map(c => [c.date, c]));
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return {days: 0, through: null};
  let n = 0;
  for (let d = dates[dates.length - 1]; byDate.has(d); d = addDays(d, -1)) {
    const c = byDate.get(d);
    if (!(c.valid && c.match === true)) break;
    n++;
  }
  return {days: n, through: dates[dates.length - 1]};
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** The newest Daily card comment for an LA date, or null. */
export function findCardComment(date, gh = ghApi) {
  const issues =
    gh(`repos/${GH_REPO}/issues`, {
      query: {state: 'open', labels: 'ops', per_page: 100},
    }) || [];
  const issue = issues.find(
    i => i.title === DAILY_CARD_TITLE && !i.pull_request,
  );
  if (!issue) return null;
  const comments =
    gh(`repos/${GH_REPO}/issues/${issue.number}/comments`, {paginate: true}) ||
    [];
  const marker = `<!-- daily-card date=${date} `;
  const hits = comments.filter(c => String(c.body || '').startsWith(marker));
  return hits.length ? {...hits[hits.length - 1], issue: issue.number} : null;
}

async function loadSnapshot(date, file, bucket) {
  // A missing --file counts as a missing snapshot (test plan T-CARD-13).
  if (file)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (bucket) {
    const s = await bucket.getJson(`snapshots/daily/${date}.json`);
    if (s) return s;
  }
  const local = resolve(LOCAL_DIR, `snapshot-${date}.json`);
  return existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')) : null;
}

export function parseArgs(argv, {today = laDate()} = {}) {
  const a = {
    date: null,
    file: null,
    upload: false,
    streak: false,
    days: 30,
    allowMissing: false,
  };
  for (const arg of argv) {
    if (arg === '--upload') a.upload = true;
    else if (arg === '--streak') a.streak = true;
    else if (arg === '--allow-missing') a.allowMissing = true;
    else if (arg.startsWith('--date=')) a.date = arg.slice(7);
    else if (arg.startsWith('--file=')) a.file = arg.slice(7);
    else if (arg.startsWith('--days=')) a.days = Number(arg.slice(7));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date))
    throw new Error(`--date must be YYYY-MM-DD: ${a.date}`);
  // A check for a future date would stop the streak at 0 until that date
  // passes (test plan N-2), so it is refused, as in snapshot.mjs.
  if (a.date && a.date > today)
    throw new Error(
      `--date ${a.date} is after today in Los Angeles (${today})`,
    );
  return a;
}

async function runStreak(args, bucket) {
  const checks = [];
  if (bucket) {
    for (const key of await bucket.list('checks/')) {
      const c = await bucket.getJson(key);
      if (c?.date) checks.push(c);
    }
  } else if (existsSync(LOCAL_DIR)) {
    for (const f of readdirSync(LOCAL_DIR).filter(name =>
      /^check-\d{4}-\d{2}-\d{2}\.json$/.test(name),
    ))
      checks.push(JSON.parse(readFileSync(resolve(LOCAL_DIR, f), 'utf8')));
  }
  const recent = checks
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-args.days);
  for (const c of recent)
    console.log(
      `  ${c.date}  valid=${c.valid ? 'yes' : 'NO '}  match=${c.match === true ? 'yes' : c.match === false ? 'NO ' : 'n/a'}  ${c.cardFound ? '' : '(no card)'}${c.diffs?.length ? ` ${c.diffs.length} diff(s)` : ''}`,
    );
  const s = streak(recent);
  console.log(
    `Streak: ${s.days} day(s) in a row valid and matching the card${s.through ? `, through ${s.through}` : ''}. Phase 1 needs 7.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = await signalsBucket(process.env);
  if (args.streak) return runStreak(args, bucket);

  const date = args.date || addDays(laDate(), -1);
  const snapshot = await loadSnapshot(date, args.file, bucket);
  if (!snapshot && !args.allowMissing) {
    console.log(
      `::error::No snapshot for ${date}${args.file ? ` (no file ${basename(args.file)})` : ''}.`,
    );
    process.exitCode = 1;
    return;
  }
  const verdict = snapshot
    ? judge(snapshot)
    : {ok: false, problems: ['no snapshot for this date']};
  let comment = null;
  try {
    comment = findCardComment(date);
  } catch (e) {
    console.log(`::warning::Daily card lookup failed: ${scrub(e.message)}`);
  }
  const parsed = comment ? parseCard(cardText(comment.body)) : null;
  const cmp =
    parsed && snapshot
      ? compareCard(parsed, snapshot.sections?.card?.data)
      : null;
  const result = {
    date,
    checkedAt: new Date().toISOString(),
    valid: verdict.ok,
    errors: verdict.problems.slice(0, 50),
    cardFound: !!comment,
    cardUrl: comment?.html_url || null,
    // Decision 12: a card that posts late can miss the tolerance, so the
    // check records both times and the gap between them (T-CARD-12).
    cardPostedAt: comment?.created_at || null,
    snapshotGeneratedAt: snapshot?.generatedAt || null,
    cardLagMinutes: lagMinutes(snapshot?.generatedAt, comment?.created_at),
    match: cmp ? cmp.match : null,
    compared: cmp ? cmp.compared : 0,
    diffs: cmp ? cmp.diffs : [],
  };

  console.log(
    `Check ${date}: valid=${result.valid} card=${result.cardFound ? 'found' : 'missing'} match=${result.match} (${result.compared} values, ${result.diffs.length} diff(s))`,
  );
  for (const e of result.errors)
    console.log(`${snapshot ? '::error::' : '::warning::'}${e}`);
  for (const d of result.diffs)
    console.log(
      `::warning::${date} ${d.field}: snapshot ${d.snapshot}, card ${d.card}`,
    );
  if (!result.cardFound)
    console.log(`::warning::No Daily card comment for ${date}.`);

  if (args.upload && bucket) {
    await bucket.putJson(`checks/${date}.json`, result);
    console.log(`Uploaded checks/${date}.json.`);
  } else {
    mkdirSync(LOCAL_DIR, {recursive: true});
    writeFileSync(
      resolve(LOCAL_DIR, `check-${date}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    if (args.upload)
      console.log(
        '::notice::Check upload skipped: a SIGNALS_R2_* key is missing.',
      );
  }
  if (!result.valid && snapshot) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(err => {
    console.error(`check failed: ${scrub(err?.message || err)}`);
    process.exit(1);
  });
}
