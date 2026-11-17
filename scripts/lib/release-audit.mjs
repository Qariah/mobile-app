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
 * The evidence slug of an Android claim (`pixel3`, `a10s`), or null for an iOS
 * claim. The artifact name `android-<slug>-…` decides first; else the device name.
 */
export function androidSlug(r) {
  const base = String(r.artifact || '')
    .split('/')
    .pop();
  const m = base.match(/^android-([a-z0-9]+)-/);
  if (m) return m[1];
  const d = String(r.device || '');
  if (!/pixel|galaxy|samsung|android|a10s/i.test(d)) return null;
  return (
    d
      .toLowerCase()
      .replace(/galaxy|samsung/g, '')
      .replace(/[^a-z0-9]/g, '') || null
  );
}

/** The file that scripts/android-evidence-install.sh writes for a slug. */
export const installFileName = slug => `android-${slug}-install.txt`;

/**
 * One line about the install file of an Android claim (issue #832). A missing
 * file means that the build on the device is not recorded.
 */
export function installLine(slug, text, build) {
  const name = installFileName(slug);
  if (text == null)
    return `  install: MISSING ${name}. The build on the device is not recorded, so this claim does not prove the build.`;
  const code = (text.match(/versionCode=(\d+)/) || [])[1];
  const ver = (text.match(/versionName=(\S+)/) || [])[1];
  if (!code) return `  install: ${name} has no versionCode. Open it.`;
  const same =
    build == null || build === '?'
      ? 'the claim has no build'
      : String(build) === code
        ? 'equals the claim build'
        : `DIFFERS from the claim build ${build}`;
  return `  install: ${name} versionCode=${code} versionName=${ver || '?'} (${same})`;
}

/**
 * The claims in the lines of results.ndjson files, oldest directory first.
 * kind `cases`: each PASS, to run again. kind `artifacts`: each PASS with its
 * artifact, to open; a PASS with no artifact prints NO ARTIFACT, a failed claim.
 * For an Android artifact claim, `readInstall(fileName)` gives the text of the
 * install file in the same evidence directory, or null; the claim then has an
 * `install:` line.
 */
export function claimsFrom(lines, kind, {readInstall} = {}) {
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
    if (kind === 'cases') {
      out.push(id);
      continue;
    }
    let claim = `${id} ${r.artifact || 'NO ARTIFACT'}`;
    const slug = readInstall && androidSlug(r);
    if (slug)
      claim += `\n${installLine(slug, readInstall(installFileName(slug)), r.build)}`;
    out.push(claim);
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
