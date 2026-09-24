#!/usr/bin/env node
// @ai
//
// scripts/incident-correlate.mjs
// ------------------------------
// Cross-source correlation pass — the shared brain the six collector lanes lack.
//
// Each lane (Sentry, PostHog, Play-vitals, Play-reviews, App-Store-reviews,
// TestFlight) files in isolation, so ONE root cause becomes N issues across
// lanes (the 5-expert review found 35 of 56 open issues collapse into ~5 root
// causes). This post-pass reads the whole open auto-filed corpus, maps each
// issue to a canonical `incident:<key>` using the regex families already in the
// lane KNOWLEDGE maps (see scripts/lib/incident-knowledge.mjs — we REUSE them,
// not reinvent), and for every incident with >= MIN_MEMBERS members:
//   1. ensures the `incident:<key>` label exists (idempotent),
//   2. applies it to all member issues,
//   3. creates/updates ONE umbrella issue
//        "[incident] <key> — N signals across M lanes"
//      that links every member with its source + per-source counts.
//
// Idempotent + safe to re-run: it UPDATES the umbrella (matched by an embedded
// marker) rather than duplicating, and only adds labels that are missing.
//
// Runs in CI (see .github/workflows/diagnostics-watch.yml, after the six
// collectors) and locally:
//   set -a && source .env.local && set +a
//   node scripts/incident-correlate.mjs --dry-run   # print the plan, change nothing
//   node scripts/incident-correlate.mjs             # apply
//
// Flags:
//   --dry-run            print the correlation plan; create/label/update nothing
//   --min-members=2      minimum member issues before an incident gets an umbrella
//   --limit=300          how many open issues to scan
//   --help
//
// Env:  GH_REPO (default omar-zarka/qariah-v2), GH_TOKEN

import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  GH_REPO,
  INCIDENTS,
  incidentByKey,
  gh,
  loadIssueCorpus,
} from './lib/incident-knowledge.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (flag('help')) {
  console.log(
    [
      'Usage: node scripts/incident-correlate.mjs [--dry-run] [--min-members=2] [--limit=300]',
      '',
      'Maps open auto-filed issues to canonical incident:<key> labels and files one',
      'umbrella issue per multi-signal incident. Idempotent. Env: GH_REPO, GH_TOKEN.',
    ].join('\n'),
  );
  process.exit(0);
}

const DRY_RUN = flag('dry-run');
const MIN_MEMBERS = Math.max(2, parseInt(opt('min-members', '2'), 10) || 2);
const LIMIT = parseInt(opt('limit', '300'), 10) || 300;

const UMBRELLA_MARKER = 'incident-umbrella:'; // <!-- incident-umbrella:cold-start-hang -->
const INCIDENT_LABEL_COLOR = '5319e7';

function ensureLabel(name, color) {
  if (DRY_RUN) return;
  try {
    gh([
      'label',
      'create',
      name,
      '--repo',
      GH_REPO,
      '--color',
      color,
      '--force',
    ]);
  } catch {
    /* exists / race — fine */
  }
}

function sourceLabel(src) {
  return (
    {
      sentry: 'Sentry',
      'play-vitals': 'Play vitals',
      posthog: 'PostHog',
      'appstore-review': 'App Store review',
      'play-review': 'Play review',
      testflight: 'TestFlight feedback',
    }[src] || src
  );
}

// Build the umbrella body listing every member grouped by source.
function umbrellaBody(key, members) {
  const inc = incidentByKey(key);
  const bySource = {};
  for (const m of members) {
    const s = m.marker?.source || 'other';
    (bySource[s] ||= []).push(m);
  }
  const sources = Object.keys(bySource).sort();
  const sourceLine = sources
    .map(s => `${sourceLabel(s)} ×${bySource[s].length}`)
    .join(' · ');

  const sections = sources
    .map(s => {
      const rows = bySource[s]
        .sort((a, b) => a.number - b.number)
        .map(m => `- #${m.number} — ${m.title.replace(/\s+/g, ' ').trim()}`)
        .join('\n');
      return `### ${sourceLabel(s)} (${bySource[s].length})\n${rows}`;
    })
    .join('\n\n');

  return `> Filed automatically by \`scripts/incident-correlate.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).
> This is an **umbrella** that groups the per-lane signals for one root cause so the tracker
> shows ~one thread per incident instead of N scattered tickets. Members are linked below; close
> the umbrella when the root cause is fixed and \`scripts/triage-lifecycle.mjs\` quiets the members.

## Incident: \`${key}\` — ${inc?.title || key}

**${members.length} signal(s) across ${sources.length} lane(s):** ${sourceLine}

${inc?.note || ''}

## Member signals

${sections}

---

### How to work this
- [ ] Confirm the members above really share this root cause (regex grouping is heuristic)
- [ ] Pick the canonical signal (the one with the richest stack / most users) to drive the fix
- [ ] When fixed, label the driving signal \`fixed-in:<versionCode>\` so the lifecycle pass auto-closes the cluster on quiet
- [ ] Close this umbrella once all members are quiet/closed

<!-- ${UMBRELLA_MARKER}${key} -->`;
}

async function main() {
  console.log(
    `▶ incident-correlate  repo=${GH_REPO} min-members=${MIN_MEMBERS}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  const corpus = loadIssueCorpus({state: 'open', limit: LIMIT});
  const autoFiled = corpus.filter(i => i.autoFiled);
  const umbrellas = corpus.filter(i =>
    (i.body || '').includes(UMBRELLA_MARKER),
  );
  console.log(
    `  scanned ${corpus.length} open issue(s): ${autoFiled.length} auto-filed, ` +
      `${umbrellas.length} existing umbrella(s)`,
  );

  // Group auto-filed (non-umbrella) issues by incident key.
  const groups = {};
  let uncategorized = 0;
  for (const i of autoFiled) {
    if ((i.body || '').includes(UMBRELLA_MARKER)) continue; // never group umbrellas
    if (!i.incident) {
      uncategorized++;
      continue;
    }
    (groups[i.incident] ||= []).push(i);
  }

  // Report the incident map.
  console.log('\n  Incident map:');
  for (const inc of INCIDENTS) {
    const members = groups[inc.key] || [];
    if (!members.length) continue;
    console.log(
      `   • ${inc.key.padEnd(22)} ${String(members.length).padStart(2)} member(s): ` +
        members.map(m => `#${m.number}`).join(' '),
    );
  }
  if (uncategorized)
    console.log(
      `   • (uncategorized: ${uncategorized} auto-filed issue(s) matched no incident)`,
    );

  // For each incident with >= MIN_MEMBERS: ensure label, apply to members,
  // create/update umbrella.
  const tmp = DRY_RUN
    ? null
    : mkdtempSync(join(tmpdir(), 'incident-correlate-'));
  let labelsApplied = 0;
  let umbrellasTouched = 0;

  for (const inc of INCIDENTS) {
    const members = groups[inc.key] || [];
    if (members.length < MIN_MEMBERS) continue;
    const incLabel = `incident:${inc.key}`;
    ensureLabel(incLabel, INCIDENT_LABEL_COLOR);

    // Apply the incident label to any member missing it.
    for (const m of members) {
      if (m.labels.includes(incLabel)) continue;
      if (DRY_RUN) {
        console.log(`  WOULD label #${m.number} += ${incLabel}`);
        labelsApplied++;
        continue;
      }
      try {
        gh([
          'issue',
          'edit',
          String(m.number),
          '--repo',
          GH_REPO,
          '--add-label',
          incLabel,
        ]);
        labelsApplied++;
      } catch (e) {
        console.warn(`  ⚠ could not label #${m.number}: ${e.message}`);
      }
    }

    // Create or update the umbrella.
    const body = umbrellaBody(inc.key, members);
    const title = `[incident] ${inc.key} — ${members.length} signals across ${
      new Set(members.map(m => m.marker?.source)).size
    } lanes`;
    const existing = umbrellas.find(u =>
      (u.body || '').includes(`${UMBRELLA_MARKER}${inc.key}`),
    );

    if (existing) {
      if (DRY_RUN) {
        console.log(
          `  WOULD update umbrella #${existing.number} (${incLabel})`,
        );
        umbrellasTouched++;
        continue;
      }
      const bodyFile = join(tmp, `${inc.key}.md`);
      writeFileSync(bodyFile, body);
      gh([
        'issue',
        'edit',
        String(existing.number),
        '--repo',
        GH_REPO,
        '--title',
        title.slice(0, 140),
        '--body-file',
        bodyFile,
        '--add-label',
        incLabel,
        '--add-label',
        'incident',
      ]);
      console.log(`  ↻ updated umbrella #${existing.number} (${inc.key})`);
      umbrellasTouched++;
    } else {
      if (DRY_RUN) {
        console.log(
          `  WOULD create umbrella "${title}" linking ${members.map(m => '#' + m.number).join(' ')}`,
        );
        umbrellasTouched++;
        continue;
      }
      ensureLabel('incident', INCIDENT_LABEL_COLOR);
      const bodyFile = join(tmp, `${inc.key}.md`);
      writeFileSync(bodyFile, body);
      const url = gh([
        'issue',
        'create',
        '--repo',
        GH_REPO,
        '--title',
        title.slice(0, 140),
        '--body-file',
        bodyFile,
        '--label',
        incLabel,
        '--label',
        'incident',
      ]);
      console.log(`  ✅ created umbrella ${url} (${inc.key})`);
      umbrellasTouched++;
    }
  }

  console.log(
    `\n▶ done — ${DRY_RUN ? 'would label' : 'labelled'} ${labelsApplied} member(s), ` +
      `${DRY_RUN ? 'would touch' : 'touched'} ${umbrellasTouched} umbrella(s).`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `labelled=${DRY_RUN ? 0 : labelsApplied}\numbrellas=${DRY_RUN ? 0 : umbrellasTouched}\n`,
      {flag: 'a'},
    );
  }
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
