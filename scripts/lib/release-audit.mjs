// @ai
//
// scripts/lib/release-audit.mjs
// -----------------------------
// What the Release Auditor audits (scripts/release-audit.mjs). Pure functions.

// A change only in these paths gives the same app, so it is not a reason for a
// new public beta. `scripts/` is here on purpose: a release script changes how
// the next build is made, but it gives testers nothing new.
const NON_APP = [
  /^planning\//,
  /^docs\//,
  /^\.claude\//,
  /^\.github\//,
  /^\.maestro\//,
  /^scripts\//,
  /\.md$/,
];

/** The changed paths that reach the app. */
export const appPaths = changed =>
  (changed || []).filter(p => !NON_APP.some(re => re.test(p)));

const DAY = 864e5;

/**
 * Should the Auditor audit `head` now?
 * @param {string[]|null} o.changed paths since the last public beta; null = no record of one.
 * @returns {{audit: boolean, reason: string}}
 */
export function decideCandidate({
  action,
  head,
  changed,
  events,
  everyDays,
  now = Date.now(),
}) {
  const verdicts = (events || []).filter(
    e => (e.kind === 'ready' || e.kind === 'not-ready') && e.action === action,
  );
  if (verdicts.some(e => e.kind === 'ready' && e.sha === head))
    return {audit: false, reason: 'this commit already has a READY line'};
  if (changed && appPaths(changed).length === 0)
    return {audit: false, reason: 'no app change since the last public beta'};
  const lastReady = verdicts.filter(e => e.kind === 'ready').pop();
  if (
    lastReady &&
    now - Date.parse(lastReady.at) < everyDays * DAY - 6 * 36e5
  ) {
    return {
      audit: false,
      reason: `the last READY (${lastReady.build}) is less than ${everyDays} days old`,
    };
  }
  return {
    audit: true,
    reason: changed
      ? `${appPaths(changed).length} app paths changed`
      : 'no record of a public beta',
  };
}

/**
 * The claims in the lines of results.ndjson files, oldest directory first.
 * kind `cases`: each PASS, to run again. kind `artifacts`: each PASS with its
 * artifact, to open; a PASS with no artifact prints NO ARTIFACT, a failed claim.
 */
export function claimsFrom(lines, kind) {
  const out = [];
  for (const line of lines) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.result !== 'PASS' || !r.case) continue;
    const id = `${r.case} ${r.device || '?'} ${r.build || '?'}`;
    out.push(kind === 'cases' ? id : `${id} ${r.artifact || 'NO ARTIFACT'}`);
  }
  return out;
}

/** Why a report cannot go out as READY. Empty when it can. */
export function readyReportProblems(report) {
  const out = [];
  const text = String(report || '');
  if (!/^###\s+What to Test\s*$/im.test(text))
    out.push('it has no `### What to Test` section');
  for (const m of text.matchAll(/^\|.*\b(FAIL|NOT RUN)\b.*\|\s*$/gm))
    out.push(`a table row says ${m[1]}: ${m[0].slice(0, 80)}`);
  return out;
}
