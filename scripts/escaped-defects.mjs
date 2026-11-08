#!/usr/bin/env node
// @ai
//
// scripts/escaped-defects.mjs
// ---------------------------
// The retro's main metric. Lists each issue whose first report came on a
// build that an audit had marked READY, or on a production build, with the
// build, the audit line and the issue (rules: scripts/lib/escaped-defects.mjs).
//
//   node scripts/escaped-defects.mjs --since=2026-10-20 [--until=<date>] [--json]
//   node scripts/escaped-defects.mjs --since=<date> --issues-file=<f> --comments-file=<f> --rollout-file=<f>
//
// It reads, read-only:
//   - the `release-audit:` lines on the open "Daily card" issue (REST, `gh api`);
//   - every issue updated since `--since` (REST, paginated), then keeps the
//     ones created in the window;
//   - docs/operations/active-rollout.json (the production builds).
// The three `--*-file` options replace the reads with JSON files (the tests
// use them; the files hold the REST shapes). `--prod=<n,m>` adds production
// builds that the rollout file no longer records.
//
// Exit 0 always, when the reads work. The count is a report, not a gate.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  escapedDefects,
  formatReport,
  trustedBuilds,
} from './lib/escaped-defects.mjs';
import {dailyCardIssue} from './lib/owner-actions-facts.mjs';
import {ownerOf} from './lib/owner-replies.mjs';
import {parseEvents} from './lib/promotion-approval.mjs';
import {GH_REPO, ghApi} from './lib/triage-common.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return [m[1], m[2] ?? true];
    }),
);

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: escaped-defects.mjs --since=YYYY-MM-DD [--until=YYYY-MM-DD] [--json] [--prod=<n,m>] [--issues-file=<f> --comments-file=<f> --rollout-file=<f>]',
  );
  process.exit(2);
}

const readJson = f => JSON.parse(readFileSync(f, 'utf8'));

function readComments() {
  if (typeof flags['comments-file'] === 'string')
    return readJson(flags['comments-file']);
  const issue = dailyCardIssue();
  if (!issue) throw new Error('no open Daily card issue');
  return ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {per_page: 100},
    paginate: true,
  });
}

function readIssues(since) {
  if (typeof flags['issues-file'] === 'string')
    return readJson(flags['issues-file']);
  return ghApi(`repos/${GH_REPO}/issues`, {
    query: {state: 'all', since: `${since}T00:00:00Z`, per_page: 100},
    paginate: true,
  });
}

function readRollout() {
  const f =
    typeof flags['rollout-file'] === 'string'
      ? flags['rollout-file']
      : join(REPO, 'docs', 'operations', 'active-rollout.json');
  try {
    return readJson(f);
  } catch {
    return null;
  }
}

function main() {
  const since = typeof flags.since === 'string' ? flags.since : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
    usage('--since=YYYY-MM-DD is required');
  const until =
    typeof flags.until === 'string' ? `${flags.until}T23:59:59Z` : '';
  const extraProd =
    typeof flags.prod === 'string' ? flags.prod.split(',').filter(Boolean) : [];
  const events = parseEvents(readComments(), {owner: ownerOf(GH_REPO)});
  const trusted = trustedBuilds({events, rollout: readRollout(), extraProd});
  const result = escapedDefects({
    issues: readIssues(since),
    trusted,
    since: `${since}T00:00:00Z`,
    until,
  });
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          since,
          until: until || null,
          trustedBuilds: [...trusted.values()].sort(
            (a, b) => a.build - b.build,
          ),
          ...result,
        },
        null,
        2,
      ),
    );
  } else {
    const t = [...trusted.values()].sort((a, b) => a.build - b.build);
    console.log(
      `trusted builds: ${t.map(x => `${x.build} (${x.kind}${x.at ? ` ${x.at.slice(0, 10)}` : ''})`).join(', ') || 'none'}`,
    );
    console.log(formatReport(result, {since}));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
    process.exit(1);
  }
}
