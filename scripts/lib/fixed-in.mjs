// @ai
//
// scripts/lib/fixed-in.mjs
// ------------------------
// The pure parts of "which build fixes which issue". No I/O here, so the unit
// tests in scripts/__tests__/fixed-in.test.mjs can cover every rule.
//
// Users:
//   scripts/stamp-fixed-in.mjs   — writes `fixed-in:<build>` (+ `behind-flag:<key>`)
//   scripts/prod-close.mjs       — closes an issue at production, and holds a
//                                  `behind-flag:` issue until the flag is on for
//                                  the production build (isFlagFullyOn)
//   scripts/triage-lifecycle.mjs — never closes a `behind-flag:` issue on its own

const FIXED_IN_RE = /^fixed-in:(\d+)$/;
const BEHIND_FLAG_RE = /^behind-flag:(.+)$/;

/**
 * Read the issue numbers that a PR body or a commit message points at.
 * Accepts `Refs #12`, `refs: #12`, `Fixes #12`, `Closes #12, #13` and the past
 * tenses. A bare `#12` with no keyword does NOT count: PR bodies cite many
 * numbers (other PRs, TECH_DEBT rows) that are not fixes.
 * @param {string} text
 * @returns {number[]} sorted, unique
 */
export function parseRefs(text) {
  const out = new Set();
  const re =
    /\b(?:refs?|fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b:?[ \t]*((?:#\d+(?:[ \t]*(?:,|and)?[ \t]*))+)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** @param {string[]} labels @returns {?number} the lowest `fixed-in:` build */
export function fixedInOf(labels) {
  const nums = (labels || [])
    .map(x => x.match(FIXED_IN_RE))
    .filter(Boolean)
    .map(m => Number(m[1]));
  return nums.length ? Math.min(...nums) : null;
}

/** @param {string[]} labels @returns {string[]} the flag keys */
export function behindFlagsOf(labels) {
  return (labels || [])
    .map(x => x.match(BEHIND_FLAG_RE))
    .filter(Boolean)
    .map(m => m[1]);
}

/**
 * Decide the `fixed-in:` label change for one issue. The LOWER build wins: it
 * is the first build that carries the fix, and `prod-close.mjs` closes the
 * issue as soon as production reaches it.
 * @param {string[]} labels the issue's current labels
 * @param {number} build    the build we stamp
 * @returns {{action:'add'|'keep', add:?string, remove:string[], kept:?number}}
 *   keep — the issue already has a build ≤ `build`. Only extra, higher
 *   `fixed-in:` labels are removed.
 */
export function planFixedIn(labels, build) {
  const current = (labels || []).filter(x => FIXED_IN_RE.test(x));
  const lowest = fixedInOf(current);
  if (lowest !== null && lowest <= build)
    return {
      action: 'keep',
      add: null,
      remove: current.filter(x => x !== `fixed-in:${lowest}`),
      kept: lowest,
    };
  return {action: 'add', add: `fixed-in:${build}`, remove: current, kept: null};
}

/**
 * The open MEMBERS of an incident group: issues that carry `incident:<slug>`,
 * are not the group issue itself (label `incident`), are not pull requests,
 * and match `re` on title + body when `re` is given.
 * @param {{number:number,title:string,body?:string,labels:string[],state?:string,isPr?:boolean}[]} issues
 * @param {string} slug
 * @param {?RegExp} re
 */
export function incidentMembers(issues, slug, re = null) {
  return issues.filter(
    i =>
      !i.isPr &&
      (i.state || 'open') === 'open' &&
      i.labels.includes(`incident:${slug}`) &&
      !i.labels.includes('incident') &&
      (!re || re.test(`${i.title}\n${i.body || ''}`)),
  );
}

/** The idempotency marker for one build's comment. */
export const stampMarker = build => `<!-- fixed-in-stamp:${build} -->`;

/**
 * The plain-language comment for one issue.
 * @param {{build:number, prs:number[], flag:?string}} o
 */
export function stampComment({build, prs, flag}) {
  const via = prs.length ? ` (${prs.map(p => `PR #${p}`).join(', ')})` : '';
  const lines = [`Build ${build} contains a fix for this${via}.`];
  if (flag) {
    lines.push(`The fix is off until the \`${flag}\` flag is on.`);
    lines.push(
      'This issue closes by itself when the build reaches production and the flag is fully on.',
    );
  } else {
    lines.push(
      'This issue closes by itself when the build reaches production.',
    );
  }
  return `${stampMarker(build)}\n${lines.join(' ')}\n\n_Written by \`scripts/stamp-fixed-in.mjs\`._`;
}

/**
 * Does one release-condition property filter on `$app_build` include `build`?
 * PostHog stores `exact` with a string or an array of strings. `in` is read the
 * same way. The numeric operators compare as numbers. Any other operator (regex,
 * is_not, ...) is not understood, so it does NOT count as a match.
 */
function appBuildMatches(p, build) {
  const op = p.operator || 'exact';
  const b = Number(build);
  const values = [].concat(p.value).map(v => String(v).trim());
  if (op === 'exact' || op === 'in') return values.includes(String(b));
  const v = Number(values[0]);
  if (values.length !== 1 || !Number.isFinite(v)) return false;
  if (op === 'gte') return b >= v;
  if (op === 'gt') return b > v;
  if (op === 'lte') return b <= v;
  if (op === 'lt') return b < v;
  return false;
}

/**
 * Is a PostHog feature flag on for the users of production build `build`?
 *
 * True when the flag is active and one release-condition group sends 100% of
 * its users (PostHog stores "100%" as `rollout_percentage: 100`, and also as
 * `null` when nobody set a number), and that group has either:
 *   - no property filter (everyone), or
 *   - only `$app_build` filters (`exact`/`in` a list, or `gte`/`gt`/`lte`/`lt`
 *     a number), and every one of them includes `build`.
 * A group with any other filter (OS, OS version, person) does not count: some
 * users of the build are outside it and run without the fix.
 *
 * Without `build`, only an unfiltered 100% group counts.
 * The caller treats "could not read the flag" as NOT on (the issue stays open).
 *
 * @param {?{active?:boolean, deleted?:boolean, filters?:{groups?:{rollout_percentage?:?number, properties?:{key:string, operator?:string, value:any}[]}[]}}} flag
 * @param {number} [build] the production build (versionCode)
 */
export function isFlagFullyOn(flag, build) {
  if (!flag || !flag.active || flag.deleted) return false;
  const groups = (flag.filters && flag.filters.groups) || [];
  return groups.some(g => {
    const full =
      g.rollout_percentage === 100 ||
      g.rollout_percentage === null ||
      g.rollout_percentage === undefined;
    if (!full) return false;
    const props = g.properties || [];
    if (!props.length) return true;
    if (
      build === undefined ||
      build === null ||
      !Number.isFinite(Number(build))
    )
      return false;
    return props.every(
      p => p.key === '$app_build' && appBuildMatches(p, build),
    );
  });
}
