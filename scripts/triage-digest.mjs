#!/usr/bin/env node
// @ai
//
// scripts/triage-digest.mjs
// -------------------------
// THE daily "where everything stands" summary for the Qariah v2 triage pipeline.
//
// Reads every open auto-filed issue, classifies each with the canonical
// scripts/lib/triage-taxonomy.mjs, and:
//   1. upserts ONE pinned "📊 Daily Triage Digest" GitHub issue (body rewritten in
//      place — idempotent, no daily issue spam),
//   2. prints a one-line `HEADLINE:` (counts per bucket),
//   3. with --json, emits the structured partition + the de-duped `loopQueue`
//      (the qariah-triage-loop skill consumes this — code is the single source of
//      truth for "what is loop-actionable", the skill prose just explains it),
//   4. optionally POSTs the headline + digest link to $DIGEST_WEBHOOK_URL
//      (Slack/Telegram-relay/email-relay) so delivery works with no desktop —
//      this is what makes the digest VPS-ready (no PushNotification dependency).
//
// It is READ-MOSTLY: it never closes/reopens/labels telemetry issues (that is
// triage-lifecycle.mjs's job) — it only writes its own pinned digest issue. Safe
// to run from CI (server-side, laptop-independent) AND from the local fix-loop.
//
// Run:
//   node scripts/triage-digest.mjs --dry-run     # print headline + body, write nothing
//   node scripts/triage-digest.mjs               # upsert the pinned digest issue
//   node scripts/triage-digest.mjs --json        # also print the machine partition
//
// Env:  GH_REPO (default omar-zarka/qariah-v2), GH_TOKEN (for gh in CI),
//       DIGEST_WEBHOOK_URL (optional — POST {text,headline,url} on a real run).

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {gh, GH_REPO, ensureLabels} from './lib/triage-common.mjs';
import {
  classify,
  parseTriageState,
  BUCKETS,
  SEV_RANK,
} from './lib/triage-taxonomy.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

const DIGEST_LABEL = 'triage-digest';
const DIGEST_TITLE = '📊 Daily Triage Digest';
const DIGEST_MARKER = '<!-- triage-digest -->';

const args = {
  dryRun: process.argv.includes('--dry-run'),
  json: process.argv.includes('--json'),
  help: process.argv.includes('--help') || process.argv.includes('-h'),
};
if (args.help) {
  console.log('Usage: node scripts/triage-digest.mjs [--dry-run] [--json]');
  process.exit(0);
}

// In --json mode stdout must be PURE JSON (the fix-loop pipes it to a parser), so
// every human line goes to stderr. Otherwise human lines go to stdout (CI log).
const logHuman = (...a) =>
  args.json ? console.error(...a) : console.log(...a);

function loadLedger() {
  try {
    const md = readFileSync(
      join(REPO_ROOT, 'docs/operations/triage-state.md'),
      'utf8',
    );
    return parseTriageState(md);
  } catch {
    return {pinnedOpen: new Set(), wontfix: new Set()};
  }
}

function listOpenIssues() {
  const raw = gh([
    'issue',
    'list',
    '--repo',
    GH_REPO,
    '--state',
    'open',
    '--limit',
    '400',
    '--json',
    'number,title,labels,url',
  ]);
  return JSON.parse(raw).map(i => ({
    number: i.number,
    title: i.title,
    url: i.url,
    labels: (i.labels || []).map(l => l.name),
  }));
}

// Collapse the loop-eligible set so the fix-loop drafts AT MOST ONE PR per incident
// root cause (the 24-issue cold-start-hang umbrella must not become 24 drafts), and
// never competes with active human work:
//   - skip every non-loop-eligible item (pinned-open, already-drafted, etc.),
//   - skip an ENTIRE incident if ANY of its members is pinned-open — that root cause
//     is under active investigation; a competing draft would conflict,
//   - one draft per surviving incident (prefer a `sentry` stack, then severity),
//   - standalone (no-incident) actionables each stand alone.
function buildLoopQueue(actionable) {
  const incidentsUnderWork = new Set(
    actionable.filter(it => it.pinned && it.incident).map(it => it.incident),
  );
  const byIncident = new Map();
  const standalone = [];
  for (const it of actionable) {
    if (!it.loopEligible) continue; // pinned / not eligible → surface, never draft
    if (it.incident && incidentsUnderWork.has(it.incident)) continue;
    if (!it.incident) {
      standalone.push(it);
      continue;
    }
    const cur = byIncident.get(it.incident);
    if (!cur || better(it, cur)) byIncident.set(it.incident, it);
  }
  const queue = [...standalone, ...byIncident.values()];
  queue.sort(
    (a, b) =>
      SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.number - b.number,
  );
  return queue;
}
function better(a, b) {
  const aS = a.labels.includes('sentry'),
    bS = b.labels.includes('sentry');
  if (aS !== bS) return aS; // prefer the one with a Sentry stack
  if (SEV_RANK[a.severity] !== SEV_RANK[b.severity])
    return SEV_RANK[a.severity] > SEV_RANK[b.severity];
  return a.number < b.number;
}

function partition(issues, ledger) {
  const buckets = Object.fromEntries(Object.keys(BUCKETS).map(k => [k, []]));
  for (const it of issues) {
    if (it.labels.includes(DIGEST_LABEL)) continue; // never classify the digest itself
    const c = classify(it, ledger);
    buckets[c.bucket].push({...it, ...c});
  }
  return buckets;
}

// Active incidents = umbrella parents, annotated with member counts pulled from
// the labels of every other issue (so the digest shows the de-dup at a glance).
function incidentSummary(issues) {
  const memberCounts = new Map();
  for (const it of issues) {
    for (const l of it.labels) {
      if (l.startsWith('incident:')) {
        const k = l.slice('incident:'.length);
        memberCounts.set(k, (memberCounts.get(k) || 0) + 1);
      }
    }
  }
  return memberCounts;
}

function bucketLine(it) {
  const lock = it.pinned ? ' 🔒' : '';
  const sev = it.severity !== 'unknown' ? ` \`${it.severity}\`` : '';
  const inc = it.incident ? ` · _${it.incident}_` : '';
  return `- #${it.number}${sev}${lock} — ${it.title}${inc}`;
}

function skipLine(it) {
  const why = it.fixedIn
    ? `✅ fixed-in:${it.fixedIn}`
    : it.pinned
      ? '🔒 pinned (under active work)'
      : '↳ covered by an incident draft';
  const sev = it.severity !== 'unknown' ? ` \`${it.severity}\`` : '';
  return `- #${it.number}${sev} — ${it.title} · _${why}_`;
}

function renderBody(buckets, loopQueue, memberCounts, generatedAt) {
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0);
  const n = k => buckets[k].length;

  const L = [];
  L.push(DIGEST_MARKER);
  L.push(
    `_Auto-generated by \`scripts/triage-digest.mjs\` — rewritten in place each run. Do not edit by hand._`,
  );
  L.push('');
  L.push(
    `**${total} open** · **${loopQueue.length} loop-actionable** (de-duped by incident) · ` +
      `${n('feature-request')} feature requests · ${n(
        'native-crash',
      )} native crashes/ANR · ` +
      `${n('investigation')} investigations · ${n('review')} reviews · ${n(
        'release-health',
      )} release-health · ` +
      `${n('awaiting-merge')} awaiting merge`,
  );
  L.push('');
  L.push(`_Generated ${generatedAt}_`);

  // 🐛 What needs fixing — the loop's de-duped queue, front and centre.
  L.push('');
  L.push('---');
  L.push('');
  L.push(`## 🐛 What needs fixing — loop queue (${loopQueue.length})`);
  L.push('');
  L.push(
    '_The fix-loop drafts a PR for these, highest-severity first, **one per incident root cause**. 🔒 = pinned-open in `triage-state.md` (under active human work; the loop skips it)._',
  );
  L.push('');
  if (loopQueue.length) {
    for (const it of loopQueue) L.push(bucketLine(it));
  } else {
    L.push(
      '_None — the actionable queue is empty (all bugs are drafted, pinned, or under an incident already being worked)._',
    );
  }

  // Actionable bugs the loop deliberately SKIPS (pinned / already-fixed-pending-close)
  // — real bugs, just not loop-draftable right now. Surfaced so they are never hidden.
  const queued = new Set(loopQueue.map(it => it.number));
  const skipped = buckets.actionable
    .filter(it => !queued.has(it.number) && (it.pinned || it.fixedIn))
    .sort(
      (a, b) =>
        SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.number - b.number,
    );
  if (skipped.length) {
    L.push('');
    L.push(`### Actionable but the loop skips (${skipped.length})`);
    for (const it of skipped) L.push(skipLine(it));
  }

  // The rest, in BUCKETS order, skipping `actionable` (shown above as the queue)
  // and empty buckets. Voluminous buckets are capped with a "+N more" line.
  const CAP = 12;
  for (const [key, meta] of Object.entries(BUCKETS)) {
    if (key === 'actionable') continue;
    const items = buckets[key];
    if (!items.length) continue;
    items.sort(
      (a, b) =>
        SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.number - b.number,
    );
    L.push('');
    L.push(`## ${meta.emoji} ${meta.heading} (${items.length})`);
    L.push('');
    if (key === 'incident') {
      // show member counts so the de-dup is legible
      for (const it of items) {
        const k = (it.labels.find(x => x.startsWith('incident:')) || '').slice(
          'incident:'.length,
        );
        const c = memberCounts.get(k);
        L.push(
          `- #${it.number} — ${it.title}${
            c ? ` · **${c} member signals**` : ''
          }`,
        );
      }
    } else {
      for (const it of items.slice(0, CAP)) L.push(bucketLine(it));
      if (items.length > CAP) L.push(`- _…and ${items.length - CAP} more_`);
    }
  }

  L.push('');
  L.push('---');
  L.push('');
  L.push('### How to read this');
  L.push(
    '- **🐛 loop queue** = the only issues the daily fix-loop drafts PRs for (real stack, not a review/gate/native-OOM, not pinned).',
  );
  L.push(
    '- **💥 native crashes / 🔍 investigations** = no JS stack → a human/device call, surfaced not auto-fixed.',
  );
  L.push(
    '- **⭐ reviews / 📉 release-health** = signals, not code bugs — never drafted.',
  );
  L.push(
    '- **🚨 incidents** = one root cause, many member signals (the de-dup). Fix the root, the members quiet.',
  );
  L.push(
    '- Closing/reopening is `triage-lifecycle.mjs`; this digest only reports.',
  );
  return L.join('\n');
}

function upsertDigestIssue(body, dryRun) {
  if (dryRun) {
    logHuman('\n' + '='.repeat(72));
    logHuman(`WOULD UPSERT pinned issue "${DIGEST_TITLE}":\n`);
    logHuman(body);
    logHuman('='.repeat(72));
    return null;
  }
  ensureLabels([DIGEST_LABEL], false);
  let existing = [];
  try {
    existing = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        GH_REPO,
        '--label',
        DIGEST_LABEL,
        '--state',
        'open',
        '--limit',
        '5',
        '--json',
        'number',
      ]),
    );
  } catch {
    /* fall through to create */
  }
  if (existing.length) {
    const num = existing[0].number;
    gh(['issue', 'edit', String(num), '--repo', GH_REPO, '--body', body]);
    return num;
  }
  const url = gh([
    'issue',
    'create',
    '--repo',
    GH_REPO,
    '--title',
    DIGEST_TITLE,
    '--label',
    DIGEST_LABEL,
    '--body',
    body,
  ]);
  const num = Number((url.match(/\/issues\/(\d+)/) || [])[1]);
  try {
    if (num) gh(['issue', 'pin', String(num), '--repo', GH_REPO]);
  } catch {
    /* >3 pins, or no perms — non-fatal */
  }
  return num;
}

async function postWebhook(headline, url) {
  const hook = process.env.DIGEST_WEBHOOK_URL;
  if (!hook || args.dryRun) return;
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      // `text` works for Slack incoming-webhooks; `headline`/`url` for a relay.
      body: JSON.stringify({text: `${headline}\n${url}`, headline, url}),
    });
    logHuman(`  webhook → ${res.status}`);
  } catch (e) {
    logHuman(`  ⚠ webhook POST failed: ${e.message}`);
  }
}

async function main() {
  const ledger = loadLedger();
  // Exclude the digest's own pinned issue from EVERY count (it is not telemetry).
  const issues = listOpenIssues().filter(i => !i.labels.includes(DIGEST_LABEL));
  const buckets = partition(issues, ledger);
  const loopQueue = buildLoopQueue(buckets.actionable);
  const memberCounts = incidentSummary(issues);
  const generatedAt =
    new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const body = renderBody(buckets, loopQueue, memberCounts, generatedAt);
  const num = upsertDigestIssue(body, args.dryRun);
  const issueUrl = num
    ? `https://github.com/${GH_REPO}/issues/${num}`
    : '(dry-run, not written)';

  const headline =
    `HEADLINE: ${issues.length} open · ${loopQueue.length} to fix · ` +
    `${buckets['feature-request'].length} feature req · ${buckets['native-crash'].length} native crash · ` +
    `${buckets.investigation.length} investigate · ${buckets.review.length} reviews · ` +
    `${buckets['release-health'].length} release-health · ${buckets['awaiting-merge'].length} awaiting-merge`;
  logHuman(headline);
  logHuman(`DIGEST: ${issueUrl}`);

  await postWebhook(headline.replace(/^HEADLINE: /, ''), issueUrl);

  if (args.json) {
    const slim = a =>
      a.map(it => ({
        number: it.number,
        title: it.title,
        severity: it.severity,
        incident: it.incident,
        pinned: it.pinned,
      }));
    process.stdout.write(
      '\n' +
        JSON.stringify(
          {
            generatedAt,
            digestIssue: num,
            counts: Object.fromEntries(
              Object.entries(buckets).map(([k, v]) => [k, v.length]),
            ),
            loopQueue: slim(loopQueue),
            buckets: Object.fromEntries(
              Object.entries(buckets).map(([k, v]) => [k, slim(v)]),
            ),
          },
          null,
          2,
        ) +
        '\n',
    );
  }
}

main().catch(e => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
