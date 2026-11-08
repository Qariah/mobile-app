#!/usr/bin/env node
// @ai
//
// scripts/upstream-seam.mjs — the seam record of the weekly upstream sync.
// ---------------------------------------------------------------------------
// The Upstream Steward (.claude/routines/qariah-upstream-steward.md) records
// each sync here, posts the report on the sync PR, and seeds an RFC for the
// file that conflicts most. The rules are in scripts/lib/upstream-seam.mjs.
//
//   node scripts/upstream-seam.mjs record [--facts=<tsv> | --clean --upstream=<sha>] [--issue=<n>] [--pr=<n>]
//        [--minutes=<n>] [--mode=dry-run|resolved] [--date=<YYYY-MM-DD>]
//        [--resolutions=<json file>] [--plan] [--write]
//   node scripts/upstream-seam.mjs report [--days=90] [--top=15] [--today=<date>] [--json]
//   node scripts/upstream-seam.mjs propose [--file=<path>] [--out=<path>] [--days=90]
//
// `record` reads a conflicted merge in the current worktree (after
// `git merge --no-commit upstream/develop` failed): each conflict file, its
// status, the lines each side changed since the merge base, the conflict hunks,
// and the DIVERGENCE_LEDGER.md rows that name it. `--facts=<tsv>` reads the same
// six columns from a file instead (file, status, ours, theirs, hunks, ledgerRows).
// `--clean --upstream=<sha>` records a sync with no conflict (the workflow's PR).
// It prints the record; `--write` appends it to docs/operations/upstream-conflicts.ndjson;
// `--plan` prints the per-file plan as a Markdown table for a PR body. The
// `held` list says why the sync waits for the owner (empty = none).
//
// `report` prints the files that conflicted most in the window, with their
// ledger rows. `propose` writes the RFC seed for the top file (a fork draft;
// never posted). Exit 0 = done, 1 = a git or file error, 2 = usage.

import {execFileSync} from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPolicy} from './lib/auto-sprint-policy.mjs';
import {
  buildRecord,
  expoMajorOf,
  inWindow,
  ledgerRowsFor,
  parseRecords,
  proposalCandidate,
  renderReport,
  renderSeed,
  reportRows,
  slugOf,
} from './lib/upstream-seam.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const NDJSON = join(REPO, 'docs', 'operations', 'upstream-conflicts.ndjson');
const LEDGER = join(REPO, 'DIVERGENCE_LEDGER.md');
const MAIN = 'origin/qariah-main';

function usage(code = 2) {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.startsWith('//'))
    .slice(1, 24)
    .map(l => l.replace(/^\/\/ ?/, ''))
    .join('\n');
  (code ? console.error : console.log)(text);
  process.exit(code);
}

function parseArgs(argv) {
  const o = {_: []};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
    else o._.push(a);
  }
  return o;
}

function git(args, {ok = false} = {}) {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (e) {
    if (ok) return '';
    throw new Error(
      `git ${args.join(' ')}: ${(e.stderr || e.message).toString().trim()}`,
    );
  }
}

function policyOf() {
  const p = readPolicy().adopt?.upstreamSync || {};
  return {
    seamPaths: p.seamPaths || [],
    maxConflictFiles: p.maxConflictFiles || 0,
    smallChange: 10,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** The facts of a live conflicted merge. */
function liveFacts(ledger) {
  const mergeHead = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
    ok: true,
  });
  if (!mergeHead)
    throw new Error(
      'no merge in progress: run `git merge --no-commit upstream/develop` first, or pass --facts=<tsv>',
    );
  const base = git(['merge-base', 'HEAD', mergeHead]);
  const files = git(['diff', '--name-only', '--diff-filter=U'])
    .split('\n')
    .filter(Boolean);
  const status = new Map(
    git(['status', '--porcelain', '--', ...files])
      .split('\n')
      .filter(Boolean)
      .map(l => [l.slice(3).replace(/^"|"$/g, ''), l.slice(0, 2)]),
  );
  const numstat = (from, to, f) => {
    const line =
      git(['diff', '--numstat', from, to, '--', f], {ok: true}).split(
        '\n',
      )[0] || '';
    const [a, d] = line.split('\t');
    return `${Number(a) || 0}+${Number(d) || 0}-`;
  };
  const facts = files.map(f => {
    let hunks = 0;
    try {
      hunks = (readFileSync(join(REPO, f), 'utf8').match(/^<{7} /gm) || [])
        .length;
    } catch {
      hunks = 0;
    }
    return {
      file: f,
      status: status.get(f) || 'UU',
      ours: numstat(base, 'HEAD', f),
      theirs: numstat(base, mergeHead, f),
      hunks,
      ledgerRows: ledgerRowsFor(ledger, f).length,
    };
  });
  return {facts, base, upstream: mergeHead};
}

function tsvFacts(path, ledger) {
  const facts = readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      const [file, status, ours, theirs, hunks, ledgerRows] = l.split('\t');
      return {
        file,
        status,
        ours,
        theirs,
        hunks: Number(hunks) || 0,
        ledgerRows:
          ledgerRows === undefined
            ? ledgerRowsFor(ledger, file).length
            : Number(ledgerRows) || 0,
      };
    });
  return {facts};
}

function record(o) {
  const ledger = readFileSync(LEDGER, 'utf8');
  const policy = policyOf();
  const live = o.clean
    ? {facts: []}
    : o.facts
      ? tsvFacts(o.facts, ledger)
      : liveFacts(ledger);
  if (o.clean && !o.upstream) throw new Error('--clean needs --upstream=<sha>');
  const upstream =
    o.upstream || live.upstream || git(['rev-parse', 'upstream/develop']);
  const base = live.base || git(['merge-base', MAIN, upstream]);
  const mainHead = git(['rev-parse', MAIN]);
  const commitsOut = git(
    ['rev-list', '--count', '--no-merges', `${mainHead}..${upstream}`],
    {ok: true},
  );
  const commits = commitsOut === '' ? null : Number(commitsOut);
  const stat = git(['diff', '--shortstat', `${mainHead}...${upstream}`], {
    ok: true,
  });
  const filesChanged =
    stat === '' ? 0 : Number((/(\d+) files? changed/.exec(stat) || [])[1]) || 0;
  const expoMajor = {
    ours: expoMajorOf(git(['show', `${mainHead}:package.json`], {ok: true})),
    theirs: expoMajorOf(git(['show', `${upstream}:package.json`], {ok: true})),
  };
  if (o.resolutions) {
    const given = JSON.parse(readFileSync(o.resolutions, 'utf8'));
    for (const f of live.facts)
      if (given[f.file]) Object.assign(f, given[f.file]);
  }
  const rec = buildRecord(
    {
      date: o.date || today(),
      upstream: git(['rev-parse', '--short=9', upstream]),
      base: base.slice(0, 9),
      mainHead: mainHead.slice(0, 9),
      mode: o.mode || 'dry-run',
      issue: o.issue ? Number(o.issue) : null,
      syncPr: o.pr ? Number(o.pr) : null,
      commits,
      filesChanged,
      minutes: Number(o.minutes) || 0,
      expoMajor,
    },
    live.facts,
    policy,
  );
  if (o.plan) {
    const lines = [
      `| File | Conflict | Qariah | Upstream | Hunks | Ledger rows | Plan |`,
      `|---|---|---|---|---|---|---|`,
      ...rec.conflicts.map(
        c =>
          `| \`${c.file}\` | ${c.kind} | ${c.ours} | ${c.theirs} | ${c.hunks} | ${c.ledgerRows} | **${c.resolution}** — ${c.note} |`,
      ),
    ];
    console.log(lines.join('\n'));
    console.log('');
    console.log(
      rec.held.length
        ? `HELD: ${rec.held.join('; ')}`
        : 'HELD: none (the Steward may open the PR ready)',
    );
  } else {
    console.log(JSON.stringify(rec));
  }
  if (o.write) {
    appendFileSync(NDJSON, JSON.stringify(rec) + '\n');
    console.error(`appended to ${NDJSON}`);
  }
}

function loadWindow(o) {
  const days = Number(o.days) || 90;
  const t = o.today || today();
  const all = existsSync(NDJSON)
    ? parseRecords(readFileSync(NDJSON, 'utf8'))
    : [];
  return {days, today: t, records: inWindow(all, t, days)};
}

function report(o) {
  const {days, today: t, records} = loadWindow(o);
  const rows = reportRows(records, readFileSync(LEDGER, 'utf8'), {
    top: Number(o.top) || 15,
  });
  if (o.json)
    console.log(
      JSON.stringify({days, today: t, syncs: records.length, rows}, null, 2),
    );
  else
    process.stdout.write(
      renderReport(rows, {days, today: t, syncs: records.length}),
    );
}

function propose(o) {
  const {days, today: t, records} = loadWindow(o);
  const rows = reportRows(records, readFileSync(LEDGER, 'utf8'), {top: 50});
  const row = o.file
    ? rows.find(r => r.file === o.file)
    : proposalCandidate(rows);
  if (!row) {
    console.error(
      o.file
        ? `no record names ${o.file} in the last ${days} days`
        : `no conflict recorded in the last ${days} days`,
    );
    process.exit(1);
  }
  const out =
    o.out || join(REPO, 'planning', 'rfc-seeds', `${t}-${slugOf(row.file)}.md`);
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, renderSeed(row, {today: t, days}));
  console.log(out);
}

const o = parseArgs(process.argv.slice(2));
const cmd = o._[0];
try {
  if (cmd === 'record') record(o);
  else if (cmd === 'report') report(o);
  else if (cmd === 'propose') propose(o);
  else usage(cmd ? 2 : 0);
} catch (e) {
  console.error(`upstream-seam: ${e.message}`);
  process.exit(1);
}
