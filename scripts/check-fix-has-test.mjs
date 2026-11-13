#!/usr/bin/env node
// @ai
//
// scripts/check-fix-has-test.mjs
// ------------------------------
// Does a fix PR carry a test, or one written reason why none is possible?
// The rule is in scripts/lib/fix-has-test.mjs (docs/operations/standing-rules/verification-testing.md,
// 2026-11-06). Run it before `gh pr ready`:
//
//   node scripts/check-fix-has-test.mjs --pr=<n> [--json]
//   node scripts/check-fix-has-test.mjs            # the PR of the current branch
//   node scripts/check-fix-has-test.mjs --files=<a,b> --body-file=<f> [--labels=bug] [--title=<t>]
//
// Exit 0: not a fix PR, or a fix PR with a test file, or with a `No test:`
// line. Exit 1: a fix PR with neither. Exit 2: no PR found, or a bad call.
// `scripts/ci-local.mjs --pr` prints the verdict as an advisory line and never
// fails on it.

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {decideFixHasTest} from './lib/fix-has-test.mjs';

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

function gh(args) {
  return execFileSync('gh', args, {cwd: REPO, encoding: 'utf8'});
}

/** The PR by number, or the PR of the current branch. */
export function readPr(number) {
  const args = ['pr', 'view'];
  if (number) args.push(String(number));
  args.push('--json', 'number,title,body,labels,files,isDraft');
  let out;
  try {
    out = gh(args);
  } catch (e) {
    const msg = String(e.stderr || e.message || '').trim();
    return {error: msg.slice(0, 200) || 'gh pr view failed'};
  }
  const j = JSON.parse(out);
  return {
    number: j.number,
    title: j.title || '',
    body: j.body || '',
    labels: (j.labels || []).map(l => l.name),
    files: (j.files || []).map(f => f.path),
    isDraft: Boolean(j.isDraft),
  };
}

function main() {
  let pr;
  if (typeof flags.files === 'string') {
    pr = {
      number: null,
      title: typeof flags.title === 'string' ? flags.title : '',
      body:
        typeof flags['body-file'] === 'string'
          ? readFileSync(flags['body-file'], 'utf8')
          : '',
      labels:
        typeof flags.labels === 'string'
          ? flags.labels.split(',').filter(Boolean)
          : [],
      files: flags.files.split(',').filter(Boolean),
    };
  } else {
    pr = readPr(typeof flags.pr === 'string' ? flags.pr : null);
    if (pr.error) {
      if (flags.json) console.log(JSON.stringify({ok: null, error: pr.error}));
      else console.log(`fix-has-test: no PR to check (${pr.error})`);
      process.exit(2);
    }
  }
  const v = decideFixHasTest(pr);
  const where = pr.number ? `PR #${pr.number}` : 'the given files';
  if (flags.json) console.log(JSON.stringify({pr: pr.number, ...v}));
  else
    console.log(`fix-has-test ${v.ok ? 'PASS' : 'FAIL'} ${where}: ${v.text}`);
  process.exit(v.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
