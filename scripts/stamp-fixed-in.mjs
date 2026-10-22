#!/usr/bin/env node
// @ai
//
// scripts/stamp-fixed-in.mjs — label the issues that a build fixes.
// ---------------------------------------------------------------------------
// WHY. The taxonomy (scripts/lib/triage-taxonomy.mjs) takes an issue out of the
// open work as soon as it has a `fixed-in:<build>` label, and
// scripts/prod-close.mjs closes it when production reaches that build. Before
// this script, only post-sprint Step 14b wrote the label, and only for PRs that
// an auto-sprint adopted. A hand-made build (a hotfix, a manual publish) wrote
// nothing. Example: PR #451 shipped in the Android hotfix build 1975, but 32
// "No focused window" ANR issues stayed in the open work for a week.
//
// WHAT. For each issue:
//   1. add `fixed-in:<build>`. When the issue already has a `fixed-in:` label,
//      the LOWER build stays and the higher one goes.
//   2. with --flag=<key>, add `behind-flag:<key>`. prod-close.mjs then waits
//      until that PostHog flag is fully on before it closes the issue.
//   3. post one comment, marked `<!-- fixed-in-stamp:<build> -->`. A second run
//      finds the marker and posts nothing.
//
// WHERE THE ISSUES COME FROM.
//   --issues=12,13  the issue numbers.
//   --pr=451        every `Refs #n` / `Fixes #n` / `Closes #n` in the PR body and
//                   in its commit messages. Repeat --pr for more PRs. The PRs are
//                   also named in the comment.
//   An issue with the `incident` label (a group issue such as #187) expands to
//   its OPEN members with the label `incident:<slug>`. --match=<regex> keeps
//   only the members whose title + body match. The group issue gets no label.
//
// Usage:
//   node scripts/stamp-fixed-in.mjs --build=1975 --pr=451                 # dry run
//   node scripts/stamp-fixed-in.mjs --build=1975 --pr=451 --issues=187 \
//     --match='Input dispatching timed out \(No focused window\)' \
//     --flag=nonblocking_splash --apply
//
// Dry run is the default. Only --apply writes. REST only (the `ghApi` helpers
// in scripts/lib/triage-common.mjs), so it also works in a cloud session.
// Env: GH_REPO (default omar-zarka/qariah-v2). Exit 2 on a usage error.

import {
  addIssueLabels,
  commentOnIssue,
  ghApi,
  removeIssueLabel,
} from './lib/triage-common.mjs';
import {
  incidentMembers,
  parseRefs,
  planFixedIn,
  stampComment,
  stampMarker,
} from './lib/fixed-in.mjs';

const REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

function parseArgs(argv) {
  const a = {prs: [], issues: [], apply: false};
  for (const x of argv) {
    const m = x.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'pr') a.prs.push(...String(v).split(',').map(Number));
    else if (k === 'issues') a.issues.push(...String(v).split(',').map(Number));
    else if (k === 'apply') a.apply = true;
    else a[k] = v ?? true;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply;
const BUILD = Number(args.build);
const FLAG = typeof args.flag === 'string' ? args.flag : null;
const MATCH = typeof args.match === 'string' ? new RegExp(args.match) : null;

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: stamp-fixed-in.mjs --build=<n> [--pr=<n>]... [--issues=1,2] [--match=<regex>] [--flag=<posthog-key>] [--apply]',
  );
  process.exit(2);
}
if (!Number.isInteger(BUILD) || BUILD < 500) usage('--build=<n> is required');
if (![...args.prs, ...args.issues].every(n => Number.isInteger(n) && n > 0))
  usage('--pr and --issues take issue numbers');
if (!args.prs.length && !args.issues.length)
  usage('give --pr=<n> or --issues=<list>');
if (FLAG && !/^[\w.-]+$/.test(FLAG)) usage('--flag takes a PostHog flag key');

// GET through the shared REST helper. `fields` are URL parameters.
function api(path, {fields = [], paginate = false} = {}) {
  return ghApi(path, {query: Object.fromEntries(fields), paginate});
}

const slim = i => ({
  number: i.number,
  title: i.title || '',
  body: i.body || '',
  state: i.state,
  isPr: !!i.pull_request,
  labels: (i.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
});

function refsOfPr(n) {
  const pr = api(`repos/${REPO}/pulls/${n}`);
  const commits = api(`repos/${REPO}/pulls/${n}/commits`, {paginate: true});
  const text = [pr.body || '', ...commits.map(c => c.commit.message)].join(
    '\n',
  );
  const refs = parseRefs(text).filter(r => r !== n);
  console.log(
    `  PR #${n}: ${refs.length ? refs.map(r => `#${r}`).join(' ') : 'no Refs/Fixes/Closes line'}`,
  );
  return refs;
}

const memberCache = new Map();
function membersOf(slug) {
  if (!memberCache.has(slug)) {
    const all = api(`repos/${REPO}/issues`, {
      fields: [
        ['labels', `incident:${slug}`],
        ['state', 'open'],
        ['per_page', '100'],
      ],
      paginate: true,
    }).map(slim);
    memberCache.set(slug, incidentMembers(all, slug, MATCH));
  }
  return memberCache.get(slug);
}

function ensureLabel(name, color, description) {
  try {
    api(`repos/${REPO}/labels/${encodeURIComponent(name)}`);
  } catch {
    ghApi(`repos/${REPO}/labels`, {
      method: 'POST',
      body: {name, color, description},
    });
  }
}

function hasMarker(n) {
  const comments = api(`repos/${REPO}/issues/${n}/comments`, {
    fields: [['per_page', '100']],
    paginate: true,
  });
  return comments.some(c => (c.body || '').includes(stampMarker(BUILD)));
}

function main() {
  console.log(
    `▶ stamp-fixed-in  build=${BUILD}${FLAG ? `  flag=${FLAG}` : ''}${MATCH ? `  match=/${MATCH.source}/` : ''}${APPLY ? '' : '  (DRY RUN — add --apply to write)'}`,
  );

  // 1. Collect the issue numbers.
  const wanted = new Set(args.issues);
  for (const pr of args.prs) for (const r of refsOfPr(pr)) wanted.add(r);

  // 2. Resolve: skip PRs and closed issues; expand incident group issues.
  const targets = new Map();
  const groups = [];
  for (const n of [...wanted].sort((a, b) => a - b)) {
    const it = slim(api(`repos/${REPO}/issues/${n}`));
    if (it.isPr) {
      console.log(`  · #${n} is a pull request — skipped`);
      continue;
    }
    if (it.labels.includes('incident')) {
      const slug = (it.labels.find(l => l.startsWith('incident:')) || '').slice(
        'incident:'.length,
      );
      if (!slug) {
        console.log(
          `  · #${n} is a group issue with no incident:<slug> label — skipped`,
        );
        continue;
      }
      const members = membersOf(slug);
      groups.push({number: n, slug, members: members.map(m => m.number)});
      console.log(
        `  #${n} is the group issue for incident:${slug} → ${members.length} open member(s)${MATCH ? ' that match' : ''}`,
      );
      for (const m of members) targets.set(m.number, m);
      continue;
    }
    if (it.state !== 'open') {
      console.log(`  · #${n} is ${it.state} — skipped`);
      continue;
    }
    targets.set(n, it);
  }

  if (APPLY) {
    ensureLabel(
      `fixed-in:${BUILD}`,
      '0e8a16',
      `Build ${BUILD} contains the fix (scripts/stamp-fixed-in.mjs)`,
    );
    if (FLAG)
      ensureLabel(
        `behind-flag:${FLAG}`,
        'c5def5',
        `The fix is off until the PostHog flag ${FLAG} is fully on`,
      );
  }

  // 3. Stamp.
  const stamped = [];
  const kept = [];
  for (const it of [...targets.values()].sort((a, b) => a.number - b.number)) {
    const plan = planFixedIn(it.labels, BUILD);
    // `ours` — this build is (or already was) the issue's fix build. A re-run
    // after a half-finished run lands here with kept === BUILD and completes it.
    const ours = plan.action === 'add' || plan.kept === BUILD;
    const add = [];
    if (plan.add) add.push(plan.add);
    if (FLAG && ours && !it.labels.includes(`behind-flag:${FLAG}`))
      add.push(`behind-flag:${FLAG}`);
    const minus = plan.remove.length ? ` −${plan.remove.join(' −')}` : '';
    if (!ours) {
      kept.push({number: it.number, kept: plan.kept});
      console.log(
        `  = #${it.number} already fixed-in:${plan.kept} (lower than ${BUILD}) — kept${minus}`,
      );
    } else {
      stamped.push(it.number);
      console.log(
        `  ${APPLY ? '✓' : '+'} #${it.number} ${add.length ? `+${add.join(' +')}` : '(labels already there)'}${minus} — ${it.title.slice(0, 80)}`,
      );
    }
    if (!APPLY) continue;
    for (const r of plan.remove) removeIssueLabel(it.number, r);
    if (add.length) addIssueLabels(it.number, add);
    if (ours && !hasMarker(it.number))
      commentOnIssue(
        it.number,
        stampComment({build: BUILD, prs: args.prs, flag: FLAG}),
      );
  }

  console.log(
    `\n▶ done — ${APPLY ? 'stamped' : 'would stamp'} ${stamped.length}${kept.length ? `, kept an earlier build on ${kept.length}` : ''}`,
  );
  if (stamped.length)
    console.log(`  stamped: ${stamped.map(n => `#${n}`).join(' ')}`);
  for (const g of groups) {
    const left = g.members.length ? '' : ' (no member matched — check --match)';
    console.log(`  group #${g.number} (incident:${g.slug})${left}`);
  }
}

try {
  main();
} catch (e) {
  console.error(`❌ ${String(e.stderr || e.message).slice(0, 400)}`);
  process.exit(1);
}
