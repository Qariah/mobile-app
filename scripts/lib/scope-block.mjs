#!/usr/bin/env node
// @ai
//
// scripts/lib/scope-block.mjs
// ---------------------------
// Parse + validate the `### Scope` block of a scoped work item: a TECH_DEBT row or a
// feature ask (or a bundle of small ones) written up so that the daily auto-sprint can
// build it with no further question (owner, 2026-11-11: "scope the entire feature and
// tech debt backlog so it gets picked up by the auto sprints automatically").
//
// The bug lane has its own contract (`scripts/lib/evidence-block.mjs`: a crash signature
// and a Sentry, PostHog or repro pointer). Scoped work has no crash, so it has this one
// instead. An issue with the label `scoped` and a valid block is in the taxonomy bucket
// `scoped` (scripts/lib/triage-taxonomy.mjs), and the auto-sprint picks up one bundle of
// them a run (the issues of one `bundle:<type>` label, at most `scopedPickup.max`;
// docs/operations/auto-sprint-policy.json).
//
// Shape (Markdown bullets, case-insensitive keys, one per line):
//
//   ### Scope
//   - Source: TECH_DEBT #305, issue #612     the rows or issues it closes
//   - Kind: tech-debt                          tech-debt | feature | bundle
//   - Goal: one sentence of what is true after the change
//   - Change: what to change, in steps
//   - Files: services/a.ts, app/b.tsx         the files it touches (at least one)
//   - Acceptance: an observable result that a reviewer or a test can check
//   - Test: jest services/a.test.ts           jest | node-test | maestro | device <case> | none: <why>
//   - Size: S                                  S (< 1 h) | M (half a day). L is refused: split it.
//   - Risk: low                                low | medium. high is refused: an owner sprint.
//   - Platform: both                           android | ios | both | none
//
// Required: Source, Kind, Goal, Change, Files, Acceptance, Test, Size (S|M), Risk (low|medium).
// Platform defaults to "none". A block that names a protected area is refused, because
// those changes need an owner sprint: QF sign-in or sync (`services/auth/`,
// `services/userState/`), the catalog in R2, a store upload, or a rollout.
//
// CLI:
//   gh issue view <n> --json body -q .body | node scripts/lib/scope-block.mjs
//   node scripts/lib/scope-block.mjs --file=body.md
//   → prints JSON {ok, missing, errors, fields}; exit 0 when ok, 1 when not, 2 on an empty read.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const REQUIRED = [
  'source',
  'kind',
  'goal',
  'change',
  'files',
  'acceptance',
  'test',
  'size',
  'risk',
];
export const KINDS = ['tech-debt', 'feature', 'bundle'];
export const SIZES = ['S', 'M'];
export const RISKS = ['low', 'medium'];
export const PLATFORMS = ['android', 'ios', 'both', 'none'];

// Paths and words that need an owner sprint (CLAUDE.md seams, external state).
export const PROTECTED = [
  {
    re: /(^|[\s,`])services\/(auth|userState)\//,
    why: 'QF sign-in or sync (services/auth/, services/userState/)',
  },
  {
    re: /catalog-r2|catalog-v1\.json|\bR2\b/,
    why: 'the catalog in R2 (external state, hard rule #14)',
  },
  {
    re: /--public-beta|--prod\b|production track|rollout/i,
    why: 'a store upload or a rollout',
  },
];

const SOURCE_REF = /(TECH_DEBT\s*(row\s*)?#?\d+|issue\s*#\d+|#\d+)/i;
const TEST_FORM = /^(jest|node-test|maestro|device)\b.+|^none:\s*\S.+/i;

/** The `### Scope` block's fields, lower-case keys. Empty object when there is no block. */
export function parseScopeBlock(text) {
  const src = String(text || '');
  const start = src.search(/^###\s+Scope\s*$/im);
  if (start < 0) return {};
  const after = src.slice(start).split('\n').slice(1);
  const fields = {};
  for (const line of after) {
    if (/^#{1,3}\s/.test(line)) break; // the next heading ends the block
    const m = /^\s*[-*]\s*([A-Za-z ]+?)\s*:\s*(.*\S)\s*$/.exec(line);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return fields;
}

/** {ok, missing, errors, fields}. */
export function validateScope(fields) {
  const missing = REQUIRED.filter(k => !fields[k]);
  const errors = [];
  const f = fields;
  if (f.source && !SOURCE_REF.test(f.source))
    errors.push('Source names no TECH_DEBT row or issue');
  if (f.kind && !KINDS.includes(f.kind.toLowerCase()))
    errors.push(`Kind is not one of ${KINDS.join(', ')}`);
  if (f.size && !SIZES.includes(f.size.toUpperCase())) {
    errors.push(`Size is not S or M (${f.size}): split an L item`);
  }
  if (f.risk && !RISKS.includes(f.risk.toLowerCase())) {
    errors.push(
      `Risk is not low or medium (${f.risk}): a high-risk change needs an owner sprint`,
    );
  }
  if (f.platform && !PLATFORMS.includes(f.platform.toLowerCase())) {
    errors.push(`Platform is not one of ${PLATFORMS.join(', ')}`);
  }
  if (f.test && !TEST_FORM.test(f.test)) {
    errors.push(
      'Test is not "jest …", "node-test …", "maestro …", "device …" or "none: <why>"',
    );
  }
  if (f.files && !/[\w-]+\/|\.\w{1,5}\b/.test(f.files))
    errors.push('Files names no path');
  const text = Object.values(f).join(' \n ');
  for (const p of PROTECTED) {
    if (p.re.test(text)) errors.push(`it touches ${p.why}: an owner sprint`);
  }
  return {
    ok: missing.length === 0 && errors.length === 0,
    missing,
    errors,
    fields,
  };
}

export function checkScope(text) {
  return validateScope(parseScopeBlock(text));
}

function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => a.startsWith('--file'));
  let text = '';
  try {
    if (fileArg) {
      const path = fileArg.includes('=')
        ? fileArg.split('=').slice(1).join('=')
        : args[args.indexOf(fileArg) + 1];
      if (!path) throw new Error('--file needs a path');
      text = readFileSync(path, 'utf8');
    } else if (!process.stdin.isTTY) {
      text = readFileSync(0, 'utf8');
    }
  } catch (e) {
    console.log(JSON.stringify({ok: false, error: String(e.message)}));
    process.exit(2);
  }
  if (!text.trim()) {
    console.log(
      JSON.stringify({
        ok: false,
        error: 'empty read: no text on stdin or in --file',
      }),
    );
    process.exit(2);
  }
  const r = checkScope(text);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
