// @ai
//
// scripts/lib/escaped-defects.mjs
// -------------------------------
// The retro's main metric: an escaped defect is an issue whose first report
// came on a build that the Release Auditor had marked READY, or on a
// production build. Pure functions; no I/O. scripts/escaped-defects.mjs reads
// the Daily card, the issues and the rollout file and applies them.
//
// Inputs:
//   - the `release-audit: READY <action> <build> commit=<sha>` lines on the
//     Daily card (scripts/lib/promotion-approval.mjs parseEvents);
//   - the production builds of docs/operations/active-rollout.json
//     (scripts/lib/release-watch.mjs productionBuilds);
//   - each issue: its creation date, its labels (`fixed-in:<build>`), and the
//     builds that its title and body name.
//
// An issue counts when a build that it names is a trusted build, and the issue
// was created after that build became trusted (a report during the audit is
// not an escape: the audit caught it). The lowest matching build is "the
// build". An issue that names no build is not counted: the retro says how
// many such issues it skipped, so the number is never a guess.

import {fixedInOf} from './fixed-in.mjs';
import {productionBuilds} from './release-watch.mjs';

/** Issues with one of these labels are not defects. */
export const NOT_A_DEFECT = [
  'ops',
  'triage-digest',
  'run-health',
  'feature-request',
  'enhancement',
  'owner-queue',
  'brief',
  'question',
  'documentation',
];

const BUILD_PATTERNS = [
  /@\d+\.\d+\.\d+\+(\d{3,5})\b/g, // com.qariah.app@3.2.3+3763
  /\bvc(\d{3,5})\b/gi, // vc3763
  /\bbuild[ #:]*(\d{3,5})\b/gi, // build 3763, build #3763
  /\b\d+\.\d+\.\d+ \((\d{3,5})\)/g, // 3.2.3 (3763)
];

/** The build numbers that a text names, sorted and unique. */
export function buildsIn(text) {
  const out = new Set();
  const s = String(text || '');
  for (const re of BUILD_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The trusted builds: every READY line, and the production builds.
 * @param {{events?: object[], rollout?: object, extraProd?: (number|string)[]}} o
 * @returns {Map<number, {build:number, kind:'ready'|'production', action:?string, at:?string, url:?string, sha:?string}>}
 *   kind production wins over ready for the same build (it is the stronger claim).
 */
export function trustedBuilds({events = [], rollout = null, extraProd = []}) {
  const map = new Map();
  for (const e of events || []) {
    if (e.kind !== 'ready') continue;
    const build = Number(e.build);
    if (!Number.isInteger(build)) continue;
    const prev = map.get(build);
    if (prev && (prev.kind === 'production' || prev.at <= e.at)) continue;
    map.set(build, {
      build,
      kind: 'ready',
      action: e.action || null,
      at: e.at || null,
      url: e.url || null,
      sha: e.sha || null,
    });
  }
  const prod = productionBuilds(rollout);
  const prodAt =
    rollout && rollout.startedAt ? `${rollout.startedAt}T00:00:00Z` : null;
  const prods = [
    ...(prod ? [prod.android, prod.ios] : []),
    ...(extraProd || []).map(Number),
  ].filter(n => Number.isInteger(n) && n > 0);
  for (const build of prods)
    map.set(build, {
      build,
      kind: 'production',
      action: 'prod',
      at:
        map.has(build) && map.get(build).at < (prodAt || '')
          ? map.get(build).at
          : prodAt,
      url: 'docs/operations/active-rollout.json',
      sha: (rollout && rollout.sha) || null,
    });
  return map;
}

const labelNames = issue =>
  (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));

/**
 * The escaped defects among `issues` (GitHub REST shape).
 * @param {{issues: object[], trusted: Map, since?: string, until?: string}} o
 * @returns {{escaped: object[], skipped: {noBuild: number, notDefect: number, outOfWindow: number, pulls: number}}}
 */
export function escapedDefects({issues, trusted, since = '', until = ''}) {
  const escaped = [];
  const skipped = {noBuild: 0, notDefect: 0, outOfWindow: 0, pulls: 0};
  for (const i of issues || []) {
    if (i.pull_request) {
      skipped.pulls++;
      continue;
    }
    const created = String(i.created_at || '');
    if ((since && created < since) || (until && created > until)) {
      skipped.outOfWindow++;
      continue;
    }
    const labels = labelNames(i);
    if (labels.some(l => NOT_A_DEFECT.includes(l))) {
      skipped.notDefect++;
      continue;
    }
    const builds = buildsIn(`${i.title || ''}\n${i.body || ''}`);
    const hits = builds
      .map(b => trusted.get(b))
      .filter(t => t && (!t.at || created >= t.at));
    if (!hits.length) {
      skipped.noBuild++;
      continue;
    }
    const t = hits[0];
    const fixedIn = fixedInOf(labels);
    escaped.push({
      number: i.number,
      title: i.title || '',
      url: i.html_url || '',
      createdAt: created,
      state: i.state || 'open',
      labels,
      build: t.build,
      kind: t.kind,
      trustedAt: t.at,
      trustedUrl: t.url,
      buildsNamed: builds,
      fixedIn,
      daysToClose:
        i.closed_at && created
          ? Math.round((Date.parse(i.closed_at) - Date.parse(created)) / 864e5)
          : null,
    });
  }
  escaped.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return {escaped, skipped};
}

/** The text report. */
export function formatReport({escaped, skipped}, {since}) {
  const ready = escaped.filter(e => e.kind === 'ready').length;
  const prod = escaped.length - ready;
  const lines = [
    `escaped defects since ${since}: ${escaped.length} (${ready} on READY builds, ${prod} on production builds)`,
  ];
  for (const e of escaped)
    lines.push(
      `  #${e.number}  build ${e.build} (${e.kind}${e.trustedAt ? ` ${e.trustedAt.slice(0, 10)}` : ''})  reported ${e.createdAt.slice(0, 10)}  ${e.fixedIn ? `fixed-in:${e.fixedIn}` : e.state === 'closed' ? 'closed' : 'open'}  ${e.title}`,
    );
  lines.push(
    `skipped: ${skipped.noBuild} issues name no trusted build, ${skipped.notDefect} are not defects, ${skipped.pulls} are pull requests, ${skipped.outOfWindow} are outside the window`,
  );
  return lines.join('\n');
}
