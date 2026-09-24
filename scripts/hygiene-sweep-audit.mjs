#!/usr/bin/env node
// @ai
//
// Read-only audit pass for the bi-weekly `qariah-hygiene-sweep` skill.
//
// WHY THIS EXISTS
// ---------------
// The sweep used to run as ~20 ad-hoc compound shell pipelines (`git show … | grep …;
// echo …; gh pr view …`). Every one of those is a unique command string, so an
// allowlist can never match them and each run re-prompts for permission a dozen-plus
// times. This script collapses the whole READ phase into ONE invocation, so a single
// allowlist entry covers it:
//
//     "Bash(node scripts/hygiene-sweep-audit.mjs:*)"
//
// STRICTLY READ-ONLY. It never writes a file, never mutates git state, never touches
// GitHub beyond `gh pr list/view` reads. The sweep stays proposal-only; judgment and
// the report are the agent's job, not this script's.
//
// Usage:
//   node scripts/hygiene-sweep-audit.mjs               # human-readable
//   node scripts/hygiene-sweep-audit.mjs --json        # machine-readable
//   node scripts/hygiene-sweep-audit.mjs --ref=<ref>   # audit a different ref
//
// Safe to run from any branch, worktree, or working directory: the repo root is
// resolved from THIS FILE's location (not `process.cwd()`), and every repo read goes
// through `git -C <root> show <ref>:<path>`, so a checkout sitting on a release branch
// with dirty files is neither read from nor disturbed.
//
// FAILS LOUDLY BY DESIGN. An audit tool that degrades quietly is worse than none. An
// unreadable ref used to yield empty strings, which then read as "convention violated"
// and produced confident HIGH findings against a compliant repo — at exit 0. Startup
// now validates the repo and the ref, and a failed read of any file the checks depend
// on aborts with a non-zero exit instead of being scored as a finding.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Prefer the --ref= flag over the env var: `HYGIENE_REF=x node script` does NOT
// prefix-match a `Bash(node scripts/hygiene-sweep-audit.mjs:*)` allowlist entry, so the
// env form silently reintroduces the prompting this script exists to remove. The env
// var is still honoured for compatibility.
const refArg = process.argv.find((a) => a.startsWith('--ref='));
const REF = refArg ? refArg.slice('--ref='.length) : process.env.HYGIENE_REF || 'origin/qariah-main';
const REPO = process.env.HYGIENE_REPO || 'omar-zarka/qariah-v2';
const UPSTREAM = process.env.HYGIENE_UPSTREAM || 'thebayaan/Bayaan';
const JSON_OUT = process.argv.includes('--json');
const TODAY = new Date().toISOString().slice(0, 10);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const findings = [];
const note = (severity, area, message) => findings.push({ severity, area, message });

function die(msg) {
  console.error(`\n✗ hygiene-sweep-audit: ${msg}\n`);
  process.exit(1);
}

function sh(cmd, args, { allowFail = false } = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}
// Every git call is pinned to the resolved repo root, so the caller's cwd is irrelevant.
const git = (...a) => sh('git', ['-C', ROOT, ...a], { allowFail: true });

// --- startup validation: refuse to audit what we cannot read ------------------------
if (!sh('git', ['-C', ROOT, 'rev-parse', '--git-dir'], { allowFail: true }).trim()) {
  die(`\`${ROOT}\` is not a git repository. This script must live inside the repo it audits.`);
}
if (!git('rev-parse', '--verify', '--quiet', `${REF}^{commit}`).trim()) {
  die(
    `ref \`${REF}\` does not resolve in ${ROOT}.\n` +
      `  Run \`git fetch origin\` first, or pass --ref=<a ref that exists>.\n` +
      `  Refusing to continue — an unreadable ref previously produced fabricated findings.`
  );
}

// `show` is load-bearing: a silent empty read is exactly what fabricated findings.
// Anything the checks below reason about must be declared required.
const show = (path, { ref = REF, required = false } = {}) => {
  const out = git('show', `${ref}:${path}`);
  if (required && !out) {
    die(`could not read \`${path}\` at \`${ref}\` — aborting rather than scoring an empty file.`);
  }
  return out;
};
const ghJson = (args) => {
  const out = sh('gh', args, { allowFail: true });
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- 1. CLAUDE.md rotation
const claude = show('CLAUDE.md', { required: true });
const datedEntries = (claude.match(/^20\d\d-\d\d-\d\d — /gm) || []).length;
const hasCollapsed = /^## Dated history \(collapsed/m.test(claude);
const hasConsolidated = /^## Standing rules \(consolidated/m.test(claude);
const claudeKb = Math.round(claude.length / 1024);

if (datedEntries > 3 || !hasCollapsed || !hasConsolidated) {
  note(
    'high',
    'CLAUDE.md rotation',
    `${datedEntries} full dated entries (convention: <=3); ` +
      `collapsed-history section ${hasCollapsed ? 'present' : 'ABSENT'}; ` +
      `consolidated-standing-rules section ${hasConsolidated ? 'present' : 'ABSENT'}; ${claudeKb} KB.`
  );
}

// ---------------------------------------------------------------- 2. Branch model vs reality
const branchModel = (claude.split(/^## Branch model$/m)[1] || '').split(/^## /m)[0];
const remoteRaw = git('ls-remote', '--heads', 'origin').trim();
if (!remoteRaw) die('`git ls-remote origin` returned nothing — network or auth failure. Aborting: branch and branch-model checks would be silently empty.');
const remoteBranches = remoteRaw
  .split('\n')
  .map((l) => l.split('\t')[1]?.replace('refs/heads/', ''))
  .filter(Boolean);
const releaseBranches = remoteBranches.filter((b) => b.startsWith('release/'));
for (const rb of releaseBranches) {
  if (!branchModel.includes(rb)) {
    note(
      'high',
      'Branch model',
      `\`${rb}\` exists on origin but CLAUDE.md's "Branch model" never names it. ` +
        `If it is the shipping line, a cold-start session reasons about the wrong tree.`
    );
  }
}

// ---------------------------------------------------------------- 3. Sprint branch staleness
const sprintBranches = remoteBranches.filter((b) => /^(sprint-|qariah\/|chore\/hygiene)/.test(b));
const branchAges = [];
for (const b of sprintBranches) {
  const ahead = git('rev-list', '--count', `${REF}..origin/${b}`).trim();
  const behind = git('rev-list', '--count', `origin/${b}..${REF}`).trim();
  const last = git('log', '-1', '--format=%ad', '--date=short', `origin/${b}`).trim();
  const ageDays = last ? Math.round((Date.parse(TODAY) - Date.parse(last)) / 86400000) : null;
  branchAges.push({ branch: b, ahead: +ahead, behind: +behind, lastCommit: last, ageDays });
  // `ls-remote` is a live network read but ahead/behind/date come from LOCAL
  // remote-tracking refs, so an un-fetched branch reads as null and used to vanish from
  // the report with no trace. Say so rather than skipping silently.
  if (ageDays === null) {
    note('low', 'Unfetched branch',
      `\`${b}\` exists on origin but has no local remote-tracking ref — not audited. Run \`git fetch origin\`.`);
    continue;
  }
  if (ageDays > 30 && +behind > 0) {
    note(
      'medium',
      'Stale branch',
      `\`${b}\` last touched ${last} (${ageDays}d), ${ahead} ahead / ${behind} behind ${REF}.`
    );
  }
}

// ---------------------------------------------------------------- 4. Open PRs
const openPrs = ghJson(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '50',
  '--json', 'number,title,baseRefName,isDraft,updatedAt']) || [];
for (const pr of openPrs) {
  const age = Math.round((Date.parse(TODAY) - Date.parse(pr.updatedAt)) / 86400000);
  if (age > 30) {
    note('medium', 'Stale PR',
      `#${pr.number} (${pr.isDraft ? 'draft' : 'ready'}, base ${pr.baseRefName}) untouched ${age}d — ${pr.title}`);
  }
}

// ---------------------------------------------------------------- 5. ACTIVE_SPRINTS sanity
const active = show('planning/ACTIVE_SPRINTS.md', { required: true });
const activeNone = /## Active\s*\n\s*\*\(none\)\*/.test(active);
const closingNone = /## Closing\s*\n\s*\*\(none\)\*/.test(active);
const inFlight = openPrs.filter((p) => /^sprint-/.test(p.baseRefName) || /Sprint \d+/.test(p.title));
if ((activeNone && closingNone) && inFlight.length > 0) {
  note('high', 'ACTIVE_SPRINTS',
    `Active and Closing both read "(none)" while ${inFlight.length} sprint PR(s) are open ` +
    `(${inFlight.map((p) => '#' + p.number).join(', ')}). This is the file hard-rule #14 depends on.`);
}
const closedRows = [...active.matchAll(/^### Sprint (\d+)/gm)].map((m) => m[1]);
if (closedRows.length > 4) {
  note('low', 'ACTIVE_SPRINTS',
    `"Closed (last 30 days)" holds ${closedRows.length} rows (back to Sprint ${closedRows.at(-1)}).`);
}

// ---------------------------------------------------------------- 6. Stale path references (evergreen only)
const treeRaw = git('ls-tree', '-r', REF, '--name-only').trim();
if (!treeRaw) die(`could not list the tree at \`${REF}\` — aborting rather than reporting every path as missing.`);
const tree = new Set(treeRaw.split('\n'));
const basenames = new Set([...tree].map((p) => p.split('/').pop()));
// Only scan the evergreen head of CLAUDE.md — dated history legitimately names deleted files.
const evergreen = claude.split(/^## (?:Last updated|Standing rules)/m)[0];
const refRe = /`([A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|jsx|sh|json|md|yml|yaml|plist|gradle|patch))`/g;
const seen = new Set();
for (const m of evergreen.matchAll(refRe)) {
  const p = m[1];
  if (seen.has(p)) continue;
  seen.add(p);
  // Only treat a token as a repo path if it actually looks like one. Bare filenames in
  // prose are usually R2 objects (`catalog-v1.json`), extension fragments (`.d.ts`), or
  // other-repo files — flagging those buries the real hits in noise.
  if (!p.includes('/') || p.startsWith('/tmp') || p.startsWith('.d.') || p.includes('*')) continue;
  // Gitignored-by-design paths are absent from the tree but genuinely exist on disk.
  if (git('check-ignore', p).trim()) continue;
  if (!tree.has(p)) {
    note('high', 'Stale reference', `CLAUDE.md (evergreen section) cites \`${p}\` — not present on ${REF}.`);
  }
}

// ------------------------------------------------ 6b. Memory dir referenced by CLAUDE.md
// The project memory path is derived from the account's home dir, so it silently goes
// stale after a machine/account migration and every "read working memory" instruction
// then points at nothing.
for (const m of claude.matchAll(/~\/\.claude\/projects\/(-[A-Za-z0-9-]+)\/memory/g)) {
  const slug = m[1];
  const expected = '-' + process.env.HOME.replace(/^\//, '').replace(/\//g, '-') + '-claude-qariah-v2';
  if (slug !== expected) {
    note('high', 'Memory path',
      `CLAUDE.md points working memory at \`${slug}\`, but this account's is \`${expected}\`.`);
    break;
  }
}

// ---------------------------------------------------------------- 7. Feature flags
const flagsSrc = show('config/featureFlags.ts', { required: true });
const declared = new Set([...flagsSrc.matchAll(/^\s{2,}([a-zA-Z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]));

// ---------------------------------------------------------------- 8. Skills cross-references
const skillDirs = git('ls-tree', '-d', '--name-only', `${REF}:.claude/skills`).trim().split('\n').filter(Boolean);
if (!skillDirs.length) die(`no skill directories found at \`${REF}:.claude/skills\` — that is a read failure, not a clean result.`);
const skillIssues = [];
for (const d of skillDirs) {
  const body = show(`.claude/skills/${d}/SKILL.md`);
  if (/config\/branding\.ts/.test(body)) {
    skillIssues.push(`${d}: cites \`config/branding.ts\` — branding is \`.js\` + sibling \`.d.ts\``);
  }
  for (const m of body.matchAll(/`(docs\/operations\/[A-Za-z0-9_.-]+)`/g)) {
    if (!tree.has(m[1])) skillIssues.push(`${d}: cites missing \`${m[1]}\``);
  }
}
for (const s of skillIssues) note('medium', 'Skills', s);

// ---------------------------------------------------------------- 9. Upstream PR queue
const upstreamPrs = ghJson(['pr', 'list', '--repo', UPSTREAM, '--state', 'open', '--limit', '50',
  '--json', 'number,title,author,updatedAt']) || [];
const ours = upstreamPrs.filter((p) => p.author?.login === 'omar-zarka');
const stalest = ours.length
  ? Math.max(...ours.map((p) => Math.round((Date.parse(TODAY) - Date.parse(p.updatedAt)) / 86400000)))
  : 0;
if (ours.length >= 6) {
  note('medium', 'Upstream queue', `${ours.length} Qariah-authored PRs open at ${UPSTREAM} — at/over the strain threshold.`);
} else if (stalest > 7) {
  note('low', 'Upstream queue',
    `${ours.length} open at ${UPSTREAM}; stalest untouched ${stalest}d — Tier-2 grouped re-ping is due (>=7d).`);
}

// ---------------------------------------------------------------- 10. Memory single-home rule
const summary = {
  ref: REF,
  date: TODAY,
  claudeMd: { bytes: claude.length, datedEntries, hasCollapsed, hasConsolidated },
  branches: branchAges,
  openPrs: openPrs.map((p) => ({ number: p.number, base: p.baseRefName, draft: p.isDraft, updated: p.updatedAt })),
  featureFlags: [...declared].sort(),
  upstreamOpenByUs: ours.map((p) => ({ number: p.number, updated: p.updatedAt })),
  findings,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\n▶ hygiene-sweep audit — ${REF} @ ${TODAY}\n`);
  console.log(`CLAUDE.md            ${claudeKb} KB · ${datedEntries} full dated entries · ` +
    `collapsed=${hasCollapsed} · consolidated=${hasConsolidated}`);
  console.log(`Feature flags        ${declared.size} declared`);
  console.log(`Open PRs (${REPO.split('/')[1]})   ${openPrs.length}`);
  console.log(`Upstream PRs by us   ${ours.length} (stalest ${stalest}d)`);
  console.log(`Branches watched     ${branchAges.length}`);
  console.log(`\n── findings (${findings.length}) ──`);
  if (!findings.length) console.log('  none — clean sweep.');
  for (const f of findings) console.log(`  [${f.severity.toUpperCase()}] ${f.area}: ${f.message}`);
  console.log('\nMemory single-home + ledger drift need judgment — audit those by hand.');
  console.log('Machine-readable: --json\n');
}
