// @ai
//
// scripts/lib/triage-common.mjs
// -----------------------------
// Shared GitHub-issue plumbing for the user-voice triage bots
// (appstore-reviews / testflight-feedback / play-reviews). The risky parts —
// dedup against already-filed issues, label creation, volume cap, CI output —
// live here so all three lanes behave identically and a first run can't flood
// the tracker. Each lane keeps its own source-specific fetch + classify code.
//
// Dedup is by an embedded HTML marker comment in the issue body, e.g.
//   <!-- play-review-id:gp:AOq... -->
// listing is scoped to the lane's primary label, and the marker prefix is
// matched exactly, so lanes that share a label (play-reviews + play-vitals both
// use `play-store`) never dedup against each other's markers.

import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

export function gh(args, {input} = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    throw new Error(`gh ${args.join(' ')} failed: ${msg.slice(0, 400)}`);
  }
}

const PALETTE = {
  'app-store': '999999',
  'play-store': '3ddc84',
  testflight: '0d96f2',
  'user-review': '5319e7',
  feedback: '1d76db',
  enhancement: 'a2eeef',
  bug: 'd73a4a',
  crash: 'b60205',
  'severity:critical': 'b60205',
  'severity:high': 'd93f0b',
  'severity:medium': 'fbca04',
  'severity:low': 'c2e0c6',
  ios: 'a2d2ff',
  android: '3ddc84',
};

export function ensureLabels(labels, dryRun) {
  if (dryRun) return;
  for (const l of labels) {
    try {
      gh([
        'label',
        'create',
        l,
        '--repo',
        GH_REPO,
        '--color',
        PALETTE[l] || 'ededed',
        '--force',
      ]);
    } catch {
      /* label exists / race — fine */
    }
  }
}

// Return a Set of already-filed marker IDs for a lane.
//   label        — the lane's primary GitHub label (scopes the listing)
//   markerPrefix — e.g. 'play-review-id:' (matched exactly inside the body)
// In --dry-run a listing failure is non-fatal (we file nothing anyway); in a
// real run we refuse to file without a working dedup check (never double-file).
export function existingMarkers(label, markerPrefix, {dryRun} = {}) {
  ensureLabels([label], dryRun);
  const set = new Set();
  let existing;
  try {
    existing = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        GH_REPO,
        '--label',
        label,
        '--state',
        'all',
        '--limit',
        '800',
        '--json',
        'title,body',
      ]),
    );
  } catch (e) {
    console.warn(
      `  ⚠ could not list existing GitHub issues for dedup: ${e.message}`,
    );
    if (!dryRun) {
      console.error('  refusing to file without a working dedup check.');
      process.exit(1);
    }
    return set;
  }
  const re = new RegExp(
    markerPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\s>]+)',
    'g',
  );
  for (const e of existing) {
    const blob = `${e.title}\n${e.body || ''}`;
    let m;
    while ((m = re.exec(blob))) set.add(m[1]);
  }
  return set;
}

// One-line-safe GitHub issue title (no newlines, capped at 140 chars).
export function ghTitle(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function firstWords(s, n = 9) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, n)
    .join(' ');
}

// items: [{ id, title, body, labels: [] }]  (id is only used for the temp file name)
export function fileIssues(items, {dryRun}) {
  let filed = 0;
  const tmp = dryRun ? null : mkdtempSync(join(tmpdir(), 'triage-'));
  for (const it of items) {
    if (dryRun) {
      console.log('\n' + '─'.repeat(72));
      console.log(`WOULD FILE: ${it.title}`);
      console.log(`  labels: ${it.labels.join(', ')}`);
      console.log(
        it.body
          .split('\n')
          .map(l => '  ' + l)
          .join('\n'),
      );
      filed++;
      continue;
    }
    ensureLabels(it.labels, false);
    const bodyFile = join(
      tmp,
      `${String(it.id)
        .replace(/[^\w.-]/g, '_')
        .slice(0, 80)}.md`,
    );
    writeFileSync(bodyFile, it.body);
    const url = gh([
      'issue',
      'create',
      '--repo',
      GH_REPO,
      '--title',
      it.title,
      '--body-file',
      bodyFile,
      ...it.labels.flatMap(l => ['--label', l]),
    ]);
    console.log(`  ✅ filed → ${url}`);
    filed++;
  }
  return filed;
}

export function emitOutput({filed, fresh, deferred = 0, dryRun}) {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      // In --dry-run nothing was actually filed, so report 0.
      `filed=${dryRun ? 0 : filed}\nnew=${fresh}\ndeferred=${deferred}\n`,
      {flag: 'a'},
    );
  }
}

export function parseArgs(argv) {
  const a = {dryRun: false, max: 15, help: false};
  for (const x of argv.slice(2)) {
    if (x === '--dry-run') a.dryRun = true;
    else if (x.startsWith('--max=')) a.max = parseInt(x.slice(6), 10) || a.max;
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

// Feature-request vs bug heuristic for a star-review body. Conservative: only
// trips `enhancement` when an explicit ask is present (so praise stays a bug-or-
// nothing). Includes a few non-English cues (the catalog is multilingual).
const FEATURE_RE =
  /\b(please add|add (a |an |the )?(option|feature|ability)|would (be |)?(nice|love|like)|wish|feature request|option to|ability to|can you (add|make|please)|it would help|suggest|deber[ií]an?|porfa|por favor|opci[oó]n|ميزة|إضافة)\b/i;
export function looksLikeFeatureRequest(text) {
  return FEATURE_RE.test(String(text || ''));
}

export function severityForRating(rating) {
  return rating <= 1
    ? 'critical'
    : rating === 2
      ? 'high'
      : rating === 3
        ? 'medium'
        : 'low';
}
