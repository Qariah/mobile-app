#!/usr/bin/env node
// @ai
//
// scripts/release-audit.mjs — the deterministic parts of the Release Auditor
// (.claude/skills/qariah-release-auditor/SKILL.md). The agent runs the devices
// and writes the verdict. This script decides what it audits, picks what it
// checks at random, and refuses a READY line that cannot be true.
//
//   node scripts/release-audit.mjs candidate --action=public-beta [--json]
//       exit 0 = audit this commit; exit 3 = skip, with the reason.
//   node scripts/release-audit.mjs sample --kind=artifacts|cases [--since=YYYY-MM-DD] [--n=5]
//       reads ~/qariah-releases/evidence/*/results.ndjson since the last public beta,
//       and prints n claims, chosen by crypto.randomInt, not by the agent.
//       An Android artifact claim also prints its android-<device>-install.txt
//       (scripts/android-evidence-install.sh), or MISSING when it is absent.
//   node scripts/release-audit.mjs what-to-test --build=<n> --out=<path>
//       writes the tester text of the newest READY comment for that build.
//   node scripts/release-audit.mjs post --verdict=READY|NOT-READY --action=public-beta
//       --build=<n> --commit=<sha> --version=<x.y.z> --report-file=<path> [--dry-run]
//       posts the verdict on the Daily card. Omar's reply is what publishes.
//       READY is refused when the commit is not on qariah-main, when App Store
//       Connect already has a build at or above this number, or when Apple has
//       closed the TestFlight train of this version (a new tag is the fix).
//
// Exit 1 = a GitHub or git error, or a refused READY. Exit 2 = usage error.

import {execFileSync} from 'node:child_process';
import {randomInt} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dailyCardIssue} from './lib/owner-actions-facts.mjs';
import {ownerOf} from './lib/owner-replies.mjs';
import {
  ACTIONS,
  approvalReply,
  notReadyLine,
  parseEvents,
  readyLine,
  whatToTest,
} from './lib/promotion-approval.mjs';
import {ascJwt} from './lib/asc-client.mjs';
import {
  claimsFrom,
  decideCandidate,
  readyReportProblems,
} from './lib/release-audit.mjs';
import {GH_REPO, commentOnIssue, ghApi} from './lib/triage-common.mjs';
import {latestBuildNumber, trainState} from './testflight-public-beta.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const git = (...a) =>
  execFileSync('git', ['-C', here, ...a], {encoding: 'utf8'}).trim();
const root = () =>
  dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter(a => a.startsWith('--'))
    .map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return [m[1], m[2] ?? true];
    }),
);
const [cmd] = argv.filter(a => !a.startsWith('--'));

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: release-audit.mjs candidate --action=<a> | sample --kind=<artifacts|cases> [--since=<date>] [--n=5] | what-to-test --build=<n> --out=<f> | post --verdict=<v> --action=<a> --build=<n> --commit=<sha> --version=<x.y.z> --report-file=<f> [--dry-run]',
  );
  process.exit(2);
}

function readEvents() {
  const issue = dailyCardIssue();
  if (!issue) throw new Error('no open Daily card issue');
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const comments = ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {per_page: 100, since},
    paginate: true,
  });
  return {
    issue,
    comments,
    events: parseEvents(comments, {owner: ownerOf(GH_REPO)}),
  };
}

/** The newest public beta: its STARTED line, followed by DONE, holds the commit. */
function lastPublicBeta(events) {
  const done = events
    .filter(
      e =>
        e.kind === 'promotion' &&
        e.state === 'DONE' &&
        e.action === 'public-beta',
    )
    .pop();
  if (done) {
    const started = events
      .filter(
        e =>
          e.kind === 'promotion' &&
          e.state === 'STARTED' &&
          e.action === 'public-beta' &&
          e.build === done.build,
      )
      .pop();
    if (started && started.sha)
      return {sha: started.sha, build: done.build, date: done.at.slice(0, 10)};
  }
  // Before the Promoter: the record that ios-archive.sh writes in the main checkout.
  try {
    const j = JSON.parse(
      readFileSync(
        join(root(), 'build', 'last-public-beta-build.json'),
        'utf8',
      ),
    );
    return j.sha
      ? {
          sha: j.sha,
          build: j.build,
          date: String(j.uploaded_at || '').slice(0, 10),
        }
      : null;
  } catch {
    return null;
  }
}

function policy() {
  const p = JSON.parse(
    readFileSync(
      join(here, '..', 'docs/operations/auto-sprint-policy.json'),
      'utf8',
    ),
  );
  return p.promotion || {};
}

async function main() {
  if (cmd === 'candidate') {
    if (!ACTIONS.includes(flags.action)) usage('--action is required');
    git('fetch', '-q', 'origin', 'qariah-main');
    const head = git('rev-parse', 'origin/qariah-main');
    const {events} = readEvents();
    const base = lastPublicBeta(events);
    const changed = base
      ? git('diff', '--name-only', `${base.sha}..${head}`)
          .split('\n')
          .filter(Boolean)
      : null;
    const r = decideCandidate({
      action: flags.action,
      head,
      changed,
      events,
      everyDays: policy().publicBetaEveryDays ?? 2,
    });
    console.log(
      flags.json
        ? JSON.stringify({...r, head, base})
        : `${r.audit ? 'AUDIT' : 'SKIP'} ${head}: ${r.reason}`,
    );
    process.exit(r.audit ? 0 : 3);
  } else if (cmd === 'sample') {
    if (!['artifacts', 'cases'].includes(flags.kind))
      usage('--kind must be artifacts or cases');
    const since =
      typeof flags.since === 'string'
        ? flags.since
        : (lastPublicBeta(readEvents().events) || {}).date || '';
    const dir = join(homedir(), 'qariah-releases', 'evidence');
    const items = [];
    for (const d of existsSync(dir) ? readdirSync(dir).sort() : []) {
      const f = join(dir, d, 'results.ndjson');
      if (d.replace(/^auto-/, '') >= since && existsSync(f)) {
        const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
        // An Android claim also prints its install file (issue #832).
        const readInstall = name => {
          const p = join(dir, d, name);
          return existsSync(p) ? readFileSync(p, 'utf8') : null;
        };
        items.push(...claimsFrom(lines, flags.kind, {readInstall}));
      }
    }
    if (!items.length) console.log('no claims to sample');
    const n = Math.min(Number(flags.n || 5), items.length);
    for (let i = 0; i < n; i++) {
      const j = i + randomInt(items.length - i);
      [items[i], items[j]] = [items[j], items[i]];
      console.log(items[i]);
    }
  } else if (cmd === 'what-to-test') {
    if (typeof flags.out !== 'string' || !/^\d+$/.test(String(flags.build)))
      usage('what-to-test needs --build=<n> and --out=<path>');
    const {comments, events} = readEvents();
    const ready = events
      .filter(e => e.kind === 'ready' && e.build === String(flags.build))
      .pop();
    const text =
      ready && whatToTest((comments.find(c => c.id === ready.id) || {}).body);
    if (!text) throw new Error(`no What to Test text for build ${flags.build}`);
    writeFileSync(flags.out, `${text}\n`);
    console.log(`✓ ${flags.out}`);
  } else if (cmd === 'post') {
    const {verdict, action, build, commit, version} = flags;
    if (!['READY', 'NOT-READY'].includes(verdict))
      usage('--verdict must be READY or NOT-READY');
    if (!ACTIONS.includes(action)) usage('--action is required');
    if (!/^\d+$/.test(String(build))) usage('--build must be a number');
    if (!/^[0-9a-f]{40}$/.test(String(commit)))
      usage('--commit must be a full sha');
    if (typeof flags['report-file'] !== 'string')
      usage('--report-file is required');
    const report = readFileSync(flags['report-file'], 'utf8').trim();
    if (!report) usage('the report is empty');
    if (verdict === 'READY') {
      const problems = readyReportProblems(report);
      if (problems.length) throw new Error(`refused: ${problems.join('; ')}`);
      git('fetch', '-q', 'origin', 'qariah-main');
      try {
        git('merge-base', '--is-ancestor', commit, 'origin/qariah-main');
      } catch {
        throw new Error(`refused: ${commit} is not on origin/qariah-main`);
      }
      if (!/^\d+\.\d+\.\d+$/.test(String(version)))
        usage('READY needs --version=<x.y.z>');
      const jwt = ascJwt();
      const top = await latestBuildNumber(jwt);
      if (Number(build) <= top)
        throw new Error(
          `refused: build ${build} is not above ${top}, the newest build on com.qariah.app. TestFlight would refuse it.`,
        );
      const train = await trainState(version, jwt);
      if (train.closed)
        throw new Error(
          `refused: the TestFlight train ${version} is closed (App Store state ${train.state}). Tag the next version on this commit.`,
        );
    }
    const first =
      verdict === 'READY'
        ? readyLine({action, build, sha: commit})
        : `${notReadyLine({action, build})} commit=${commit}`;
    const ask =
      verdict === 'READY'
        ? `\n\n---\n\n**To publish, add this exact comment on this issue:**\n\n\`\`\`\n${approvalReply({action, build})}\n\`\`\`\n\nThe reply is valid for 7 days. The Promoter reads it at 08:00 and 23:00 PT. To stop after a reply: \`owner-reply: cancel ${build}\`.`
        : '';
    const body = `${first}\n\n${report}${ask}`;
    if (flags['dry-run']) {
      console.log(`[dry-run] would comment:\n${body}`);
    } else {
      const issue = dailyCardIssue();
      if (!issue) throw new Error('no open Daily card issue');
      console.log(`✓ ${commentOnIssue(issue.number, body)}`);
    }
  } else {
    usage(cmd ? `unknown command "${cmd}"` : 'no command');
  }
}

main().catch(e => {
  console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
  process.exit(1);
});
