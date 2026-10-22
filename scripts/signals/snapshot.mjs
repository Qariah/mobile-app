#!/usr/bin/env node
// @ai
//
// scripts/signals/snapshot.mjs
// ----------------------------
// Signals plan, Phase 1 (planning/signals-phase1-design.md): compute every
// number of the engagement page and the daily brief once a day, in one
// deterministic job, and write one JSON file for the day.
//
//   node scripts/signals/snapshot.mjs                    # all sections → build/signals/snapshot-<date>.json
//   node scripts/signals/snapshot.mjs --only=active,use  # some sections (the others: pending)
//   node scripts/signals/snapshot.mjs --date=2026-10-19  # the LA date of the run (series end the day before)
//   node scripts/signals/snapshot.mjs --upload           # also write snapshots/daily/<date>.json and
//                                                        # snapshots/latest.json to the signals bucket
//   node scripts/signals/snapshot.mjs --out=<dir>        # the local folder (default build/signals)
//
// Env: POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID (required), SENTRY_READ_TOKEN,
// GOOGLE_PLAY_SA_JSON, APP_STORE_CONNECT_API_KEY_*, SIGNALS_R2_* (for --upload and
// the App Store reports), V1_DB_RO_URL (optional). Locally: source .env.local.
//
// Exit 1 when the file fails the schema, a people count of 1 to 4 is left in
// it, or a required section is not `ok` or `partial` (in a run without
// --only). A failed optional section prints ::warning:: and the run passes. A
// file that fails is written locally but never uploaded. In CI without the
// PostHog key the job prints ::notice:: and passes; locally it exits 1.
// snapshots/latest.json moves only forward: a run for an older --date leaves it.
//
// Test hooks (for planning/signals-phase1-test-plan.md; nothing sets them in CI):
//   SIGNALS_FAIL=<name>[,<name>]   that section's collect() throws "injected failure"
//   SIGNALS_INJECT_SMALL=<name>    one people count of that section becomes 3 before
//                                  the checks, to prove that they catch it
// The repo's eslint config declares no Node globals; these are Node builtins.
/* global Buffer */

import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SECTIONS} from './sections/index.mjs';
import {SCHEMA_VERSION, validateSnapshot} from './schema.mjs';
import {makeContext, scrub, ROOT} from './lib/context.mjs';
import {COUNT_KEY, findSmallCells, laDate, OWNER_TZ} from './lib/rules.mjs';
import {LAB_EXACT, LAB_PATTERNS} from '../lib/lab-exclusion.mjs';

export const MAX_BYTES = 2 * 1024 * 1024;
const CONCURRENCY = 2; // PostHog limits concurrent queries per project

export const RULES = {
  lab: `PostHog numbers exclude $device_name IN (${LAB_EXACT.join(', ')}) and ILIKE ${LAB_PATTERNS.join(' / ')}; a NULL $device_name counts as a person (scripts/lib/lab-exclusion.mjs)`,
  person:
    'one PostHog person_id = one install (the app never calls identify())',
  suppression:
    'a count of installs, users or devices from 1 to 4 is "<5"; an event count is "<5" when its installs are 1 to 4; 0 stays 0',
  rates:
    '{num, den, value, lowN}: value is null when a side is "<5" or den is 0; lowN = den 5 to 29',
  days: `calendar days in ${OWNER_TZ}; weeks start on Monday; the calendar sections (active, use, weekly, retention, funnel, content, restore, listens) end at dataThrough (date - 1) and count only events that PostHog received by asOf; card, engagement, health, failures, focus, stores and v1Backend measure at run time (each states its window)`,
  privacy:
    'counts only: no person or device id, email, IP address, reviewer name or user text; no geography, except one part: country is computed for listens (listens.splits.country, country names with play counts); the page and its API hide it until the privacy policy covers location and IP (D6)',
};

export function parseArgs(argv, {today = laDate()} = {}) {
  const a = {only: null, date: null, upload: false, out: 'build/signals'};
  for (const arg of argv) {
    if (arg === '--upload') a.upload = true;
    else if (arg.startsWith('--only='))
      a.only = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--date=')) a.date = arg.slice(7);
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date))
    throw new Error(`--date must be YYYY-MM-DD: ${a.date}`);
  // A date after today (LA) would hold empty days and could pin latest.json
  // to the future (test plan T-CAL-09).
  if (a.date && a.date > today)
    throw new Error(
      `--date ${a.date} is after today in Los Angeles (${today})`,
    );
  return a;
}

/**
 * Run the sections. Independent sections run CONCURRENCY at a time; a section
 * with `after` runs once those are done and sees their results in ctx.sections.
 * A section never stops the run: an error becomes {status: 'error'}.
 */
export async function runSections(sections, ctx, {only = null} = {}) {
  const results = {};
  const fail = String(ctx.env?.SIGNALS_FAIL || '')
    .split(',')
    .filter(Boolean);
  const runOne = async s => {
    if (only && !only.includes(s.name)) {
      results[s.name] = {
        status: 'pending',
        source: 'not run (--only)',
        ms: 0,
        data: null,
      };
      return;
    }
    const t0 = Date.now();
    let r;
    try {
      if (fail.includes(s.name))
        throw new Error('injected failure (SIGNALS_FAIL)');
      r = await s.collect({...ctx, sections: results});
      if (!r || typeof r !== 'object' || !r.status)
        throw new Error('collect() returned no {status}');
    } catch (e) {
      r = {
        status: 'error',
        source: s.source || 'unknown',
        data: null,
        error: scrub(e?.message || e, ctx.env),
      };
    }
    results[s.name] = {
      status: r.status,
      source: r.source || 'unknown',
      ms: Date.now() - t0,
      ...(r.notes?.length ? {notes: r.notes.map(n => scrub(n, ctx.env))} : {}),
      ...(r.error ? {error: scrub(r.error, ctx.env)} : {}),
      data: r.data ?? null,
    };
  };

  const first = sections.filter(s => !s.after?.length);
  const later = sections.filter(s => s.after?.length);
  const queue = [...first];
  await Promise.all(
    Array.from({length: CONCURRENCY}, async () => {
      while (queue.length) await runOne(queue.shift());
    }),
  );
  // Derived sections in registry order; each may read any section before it.
  for (const s of later) await runOne(s);

  // Keep the registry order in the file.
  return Object.fromEntries(sections.map(s => [s.name, results[s.name]]));
}

export function gitInfo(env = process.env) {
  let sha = env.GITHUB_SHA || '';
  if (!sha) {
    try {
      sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      sha = 'unknown';
    }
  }
  const ref = env.GITHUB_REF_NAME || '';
  return ref ? {sha, ref} : {sha};
}

/** Set the first people count found in a section to 3 (SIGNALS_INJECT_SMALL). */
export function injectSmall(section) {
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === 'number' && COUNT_KEY.test(key)) {
          v[i] = 3;
          return true;
        }
        if (v[i] && typeof v[i] === 'object' && walk(v[i], key)) return true;
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'number' && COUNT_KEY.test(k)) {
          v[k] = 3;
          return true;
        }
        if (x && typeof x === 'object' && walk(x, k)) return true;
      }
    }
    return false;
  };
  return walk(section?.data, '');
}

/**
 * The checks that decide the exit code. Returns {ok, problems[], bytes}.
 * full — a run of every section: a required section must then be ok or partial.
 */
export function judge(snapshot, sections = SECTIONS, {full = true} = {}) {
  const problems = [];
  const v = validateSnapshot(snapshot);
  if (!v.valid) problems.push(...v.errors.map(e => `schema: ${e}`));
  const small = findSmallCells(snapshot.sections);
  if (small.length)
    problems.push(...small.slice(0, 20).map(p => `small cell: ${p}`));
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_BYTES) problems.push(`size: ${bytes} bytes > ${MAX_BYTES}`);
  for (const s of sections) {
    const r = snapshot.sections?.[s.name];
    if (!s.required || !r) continue;
    if (r.status === 'error')
      problems.push(`required section ${s.name} failed: ${r.error}`);
    else if (full && !['ok', 'partial'].includes(r.status))
      problems.push(`required section ${s.name} is ${r.status}`);
  }
  return {ok: problems.length === 0, problems, bytes};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  if (!env.POSTHOG_PERSONAL_API_TOKEN || !env.POSTHOG_PROJECT_ID) {
    const msg =
      'Signals snapshot skipped: missing POSTHOG_PERSONAL_API_TOKEN or POSTHOG_PROJECT_ID. See planning/signals-phase1-design.md.';
    if (env.GITHUB_ACTIONS) {
      console.log(`::notice::${msg}`);
      return;
    }
    console.error(msg);
    process.exit(1);
  }

  const ctx = makeContext({date: args.date, env});
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    date: ctx.date,
    dataThrough: ctx.dataThrough,
    asOf: ctx.asOf,
    tz: OWNER_TZ,
    git: gitInfo(env),
    rules: RULES,
    sections: await runSections(SECTIONS, ctx, {only: args.only}),
  };

  if (env.SIGNALS_INJECT_SMALL)
    injectSmall(snapshot.sections[env.SIGNALS_INJECT_SMALL]);
  const verdict = judge(snapshot, SECTIONS, {full: !args.only});
  const outDir = resolve(ROOT, args.out);
  mkdirSync(outDir, {recursive: true});
  const file = resolve(outDir, `snapshot-${ctx.date}.json`);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    `Signals snapshot ${ctx.date} (data through ${ctx.dataThrough}, events received by ${ctx.asOf}), ${verdict.bytes} bytes → ${file}`,
  );
  for (const [name, s] of Object.entries(snapshot.sections)) {
    const req = SECTIONS.find(x => x.name === name)?.required
      ? ' (required)'
      : '';
    console.log(
      `  ${name.padEnd(11)} ${s.status.padEnd(14)} ${String(s.ms).padStart(6)} ms${req}${s.error ? `  ${s.error}` : ''}`,
    );
    if (s.status === 'error' && !req)
      console.log(`::warning::signals section ${name} failed: ${s.error}`);
  }

  if (!verdict.ok) {
    for (const p of verdict.problems) console.log(`::error::${p}`);
    process.exitCode = 1;
    return; // never upload a file that fails the checks
  }

  if (args.upload) {
    const bucket = await ctx.bucket();
    if (!bucket) {
      const msg = 'Upload skipped: a SIGNALS_R2_* key is missing.';
      console.log(env.GITHUB_ACTIONS ? `::notice::${msg}` : msg);
      return;
    }
    await bucket.putJson(`snapshots/daily/${ctx.date}.json`, snapshot);
    const latest = await bucket
      .getJson('snapshots/latest.json')
      .catch(() => null);
    if (ctx.date <= laDate() && (!latest?.date || latest.date <= ctx.date)) {
      await bucket.putJson('snapshots/latest.json', snapshot);
      console.log(
        `Uploaded snapshots/daily/${ctx.date}.json and snapshots/latest.json.`,
      );
    } else {
      console.log(
        `Uploaded snapshots/daily/${ctx.date}.json; latest.json stays at ${latest.date} (newer).`,
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(err => {
    console.error(`snapshot failed: ${scrub(err?.message || err)}`);
    process.exit(1);
  });
}
