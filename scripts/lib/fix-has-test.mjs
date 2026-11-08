// @ai
//
// scripts/lib/fix-has-test.mjs
// ----------------------------
// The rule "every fix PR carries a test, or one written sentence why none is
// possible" (CLAUDE.md "Verification & testing", 2026-11-06). Pure functions;
// no I/O. scripts/check-fix-has-test.mjs reads the PR and applies them.
//
// A PR is a fix when it has the label `bug`, `crash` or `sentry`, when its
// body points at an issue with `Refs #n` (or Fixes, Closes; scripts/lib/
// fixed-in.mjs parseRefs), or when its title starts with `fix`.
//
// A test is a Jest suite, a script test (node --test), a Maestro flow, a case
// in the regression catalog, a device case script, or a hook test. Any changed
// file on one of those paths counts.
//
// The written reason is one line of the PR body that starts with `No test:`
// and says why no test is possible. An empty reason does not count.

import {parseRefs} from './fixed-in.mjs';

export const FIX_LABELS = ['bug', 'crash', 'sentry'];

/** Paths that hold a test or a check. */
export const TEST_PATHS = [
  /(^|\/)__tests__\//,
  /\.test\.(m?[jt]sx?|cjs)$/,
  /(^|\/)__mocks__\//,
  /^\.maestro\/.*\.ya?ml$/,
  /^docs\/operations\/regression-test-plan\.md$/,
  /^scripts\/iphone\/cases\.mjs$/,
  /^\.claude\/hooks\/.*\.test\.sh$/,
  /^\.claude\/hooks\/test-guards\.sh$/,
  /^e2e\//,
];

const NO_TEST_LINE = /^[ \t]*(?:[-*][ \t]+)?No test:[ \t]*(\S.*)$/im;

/** True when the path holds a test or a check. */
export const isTestPath = p => TEST_PATHS.some(re => re.test(String(p)));

/**
 * Is this PR a fix?
 * @param {{labels?: string[], body?: string, title?: string}} pr
 * @returns {{isFix: boolean, because: string}}
 */
export function classifyFix({labels = [], body = '', title = ''}) {
  const label = (labels || []).find(l => FIX_LABELS.includes(l));
  if (label) return {isFix: true, because: `label ${label}`};
  const refs = parseRefs(body);
  if (refs.length)
    return {isFix: true, because: `Refs #${refs.join(', #')} in the body`};
  if (/^fix\b/i.test(String(title).trim()))
    return {isFix: true, because: 'the title starts with fix'};
  return {isFix: false, because: 'no fix label, no Refs line, no fix title'};
}

/** The `No test:` sentence of a body, or null. */
export function noTestReason(body) {
  const m = String(body || '').match(NO_TEST_LINE);
  return m ? m[1].trim() : null;
}

/**
 * The verdict for one PR.
 * @param {{labels?: string[], body?: string, title?: string, files: string[]}} pr
 * @returns {{ok: boolean, isFix: boolean, tests: string[], reason: ?string, text: string}}
 *   ok — true when the PR is not a fix, or carries a test, or has a reason.
 *   text — one line for a report.
 */
export function decideFixHasTest({labels, body, title, files}) {
  const {isFix, because} = classifyFix({labels, body, title});
  const tests = (files || []).filter(isTestPath);
  const reason = noTestReason(body);
  if (!isFix)
    return {
      ok: true,
      isFix,
      tests,
      reason,
      text: `not a fix PR (${because}); no test required`,
    };
  if (tests.length)
    return {
      ok: true,
      isFix,
      tests,
      reason,
      text: `fix PR (${because}) carries ${tests.length} test file${tests.length === 1 ? '' : 's'}: ${tests.join(', ')}`,
    };
  if (reason)
    return {
      ok: true,
      isFix,
      tests,
      reason,
      text: `fix PR (${because}) has no test file; the body says why: "No test: ${reason}"`,
    };
  return {
    ok: false,
    isFix,
    tests,
    reason,
    text: `fix PR (${because}) has no test file and no "No test: <why>" line in the body`,
  };
}
