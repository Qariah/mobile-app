#!/usr/bin/env node
// @ai
//
// scripts/upstream-queue.mjs — the open Qariah PRs on thebayaan/Bayaan.
// ---------------------------------------------------------------------------
//   node scripts/upstream-queue.mjs list [--json] [--limit=6] [--ping-days=7] [--now=<ISO>]
//   node scripts/upstream-queue.mjs check            exit 0 under the limit, 1 over it
//   node scripts/upstream-queue.mjs round-up --out=<file>   writes the draft comment; never posts
//
// Reads GitHub REST through `gh api` (read-only). `list` prints the table (or
// JSON) with the age and the last activity of each PR, and who it waits on.
// `check` is the guard the Steward runs before it proposes a new upstream post.
// `round-up` writes the text when the oldest PR that waits on the maintainer
// has waited `--ping-days` or more (default 7); it writes nothing otherwise.
// Rules: scripts/lib/upstream-queue.mjs. Exit 2 = usage or a GitHub error.

import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {
  queueItem,
  renderTable,
  roundUpText,
  summarize,
} from './lib/upstream-queue.mjs';

const UPSTREAM = process.env.UPSTREAM_REPO || 'thebayaan/Bayaan';

function parseArgs(argv) {
  const o = {_: []};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
    else o._.push(a);
  }
  return o;
}

function api(path) {
  const out = execFileSync('gh', ['api', '--paginate', path], {
    encoding: 'utf8',
  });
  // --paginate concatenates arrays; join them.
  return JSON.parse(
    '[' +
      out
        .trim()
        .replace(/\]\s*\[/g, ',')
        .replace(/^\[|\]$/g, '') +
      ']',
  );
}

function readQueue(o) {
  const me =
    o.author ||
    execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
    }).trim();
  const now = o.now || new Date().toISOString();
  const prs = api(`repos/${UPSTREAM}/pulls?state=open&per_page=100`).filter(
    p => p.user && p.user.login === me,
  );
  const items = prs.map(pr => {
    const comments = api(
      `repos/${UPSTREAM}/issues/${pr.number}/comments?per_page=100`,
    );
    const reviews = api(
      `repos/${UPSTREAM}/pulls/${pr.number}/reviews?per_page=100`,
    );
    const lc = comments[comments.length - 1];
    const lr = reviews[reviews.length - 1];
    return queueItem(
      pr,
      {
        lastComment: lc ? {user: lc.user.login, at: lc.created_at} : undefined,
        lastReview: lr
          ? {user: lr.user.login, state: lr.state, at: lr.submitted_at}
          : undefined,
      },
      {now, us: me},
    );
  });
  return summarize(items, {
    limit: Number(o.limit) || undefined,
    pingDays: Number(o['ping-days']) || undefined,
  });
}

const o = parseArgs(process.argv.slice(2));
const cmd = o._[0];
try {
  if (cmd === 'list') {
    const s = readQueue(o);
    if (o.json) console.log(JSON.stringify(s, null, 2));
    else process.stdout.write(renderTable(s));
  } else if (cmd === 'check') {
    const s = readQueue(o);
    console.log(
      `${s.open} open of ${s.limit}: ${s.canPropose ? 'a new upstream post is allowed' : 'REFUSED — the queue is over its limit; no new upstream post'}`,
    );
    process.exit(s.canPropose ? 0 : 1);
  } else if (cmd === 'round-up') {
    const s = readQueue(o);
    const text = roundUpText(s, {
      pingDays: Number(o['ping-days']) || undefined,
    });
    if (!text) {
      console.log(
        `no round-up due: the oldest wait on the maintainer is ${s.oldestIdleDays} days`,
      );
    } else if (o.out) {
      writeFileSync(o.out, text);
      console.log(`round-up draft written to ${o.out} (not posted)`);
    } else {
      process.stdout.write(text);
    }
  } else {
    console.error(
      'usage: node scripts/upstream-queue.mjs <list|check|round-up> [--json] [--out=<file>] [--limit=6] [--ping-days=7]',
    );
    process.exit(2);
  }
} catch (e) {
  console.error(`upstream-queue: ${e.message}`);
  process.exit(2);
}
