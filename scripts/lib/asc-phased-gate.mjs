// @ai
//
// scripts/lib/asc-phased-gate.mjs
// -------------------------------
// The pure rules behind `asc-phased-release.mjs status --require` (TECH_DEBT #188).
//
// Phased release is PER VERSION and is not inherited. A version that goes to
// review without a phased-release record ships to 100% of users at once when
// Apple approves it (releaseType AFTER_APPROVAL has no human step). On
// 2026-08-15 version 3.2.1 sat in that state and only a chance look caught it.
//
// No Qariah script submits an App Store version (the owner or `asc publish`
// does). So the check is a gate that runs BEFORE the submit: it reads every
// App Store version that is not released yet and refuses when one of them has
// no phased-release record.
//
// Exit codes: 0 = pass, 1 = refused, 2 = the check did not run (a read error, a
// missing key, a page that may hide a waiting version). A thrown error is always
// exit 2: it must never look like a refusal.
//
// A TestFlight public beta has no App Store version. With no waiting version the
// gate refuses, and --allow-no-phased-release turns that into a WARNING and a pass.
//
// This file has no network and no process exit, so a test can run it.

// Apple's states for a version that is already out. Any other state, and any
// state we do not know, counts as "not released": the gate fails closed.
export const RELEASED_STATES = new Set([
  'READY_FOR_SALE',
  'READY_FOR_DISTRIBUTION',
  'REPLACED_WITH_NEW_VERSION',
  'REMOVED_FROM_SALE',
  'DEVELOPER_REMOVED_FROM_SALE',
]);

export const COMMANDS = ['status', 'pause', 'resume', 'complete'];
export const FLAGS = ['--require', '--allow-no-phased-release'];

export function isReleasedState(state) {
  return RELEASED_STATES.has(state);
}

/**
 * Read the command line (without `node` and the script path).
 * Returns {cmd, require, allowNone, error}. `error` is a usage message or null.
 */
export function parseArgs(argv) {
  const flags = argv.filter(a => a.startsWith('--'));
  const words = argv.filter(a => !a.startsWith('--'));
  const cmd = words[0] || 'status';
  const out = {
    cmd,
    require: flags.includes('--require'),
    allowNone: flags.includes('--allow-no-phased-release'),
    error: null,
  };
  const usage =
    'usage: asc-phased-release.mjs <status|pause|resume|complete>\n' +
    '       asc-phased-release.mjs status --require [--allow-no-phased-release]';
  const unknown = flags.find(f => !FLAGS.includes(f));
  if (!COMMANDS.includes(cmd)) {
    out.error = usage;
  } else if (words.length > 1) {
    out.error = `${usage}\nunexpected argument: ${words[1]}`;
  } else if (unknown) {
    out.error = `${usage}\nunknown option: ${unknown}`;
  } else if ((out.require || out.allowNone) && cmd !== 'status') {
    out.error = `${usage}\n--require and --allow-no-phased-release belong to "status".`;
  } else if (out.allowNone && !out.require) {
    out.error = `${usage}\n--allow-no-phased-release only works together with --require.`;
  }
  return out;
}

/**
 * Judge the phased-release state of the App Store versions.
 *
 * `versions` is a list of {versionString, state, phased}. `phased` is the
 * phased-release record of the version, or null when there is none.
 * `hasNextPage` is true when the list of versions has a page after this one.
 * Returns {exitCode, lines}: 0 = pass, 1 = refuse, 2 = the check cannot say.
 * The caller prints `lines` (to stderr when the exit code is not 0) and exits.
 */
export function evaluateRequire(
  versions,
  {allowNone = false, hasNextPage = false} = {},
) {
  const lines = [];

  // A page with no released version and a next page: an older version that is
  // not released yet may be on a later page. We did not read it, so we cannot
  // say that every waiting version has a phased release.
  if (hasNextPage && !versions.some(v => isReleasedState(v.state))) {
    return didNotRun(
      'the first page of versions has no released version and more pages exist, ' +
        'so a waiting version may be on a page that was not read',
    );
  }

  const pending = versions.filter(v => !isReleasedState(v.state));

  if (pending.length === 0) {
    const newest = versions[0];
    const none = `no App Store version is waiting for release${
      newest ? ` (newest: ${newest.versionString}, state=${newest.state})` : ''
    }.`;
    if (allowNone) {
      // A TestFlight public beta has no App Store version to submit.
      lines.push(
        `WARNING: ${none}`,
        '  --allow-no-phased-release is set, so this check passes. There is no',
        '  App Store version to check. This is right for a TestFlight public beta.',
      );
      return {exitCode: 0, lines};
    }
    lines.push(
      `REFUSED: ${none}`,
      '  Create the new version in App Store Connect, turn on "Phased Release for',
      '  Automatic Updates" on it, then run this check again.',
      '  For a TestFlight public beta (no App Store submission), add --allow-no-phased-release.',
    );
    return {exitCode: 1, lines};
  }

  const missing = [];
  for (const v of pending) {
    if (v.phased) {
      const st = v.phased.attributes?.phasedReleaseState ?? 'unknown';
      lines.push(
        `OK: iOS ${v.versionString} (state=${v.state}) has a phased release (${st}).`,
      );
    } else {
      missing.push(v);
    }
  }

  if (missing.length === 0) {
    return {exitCode: 0, lines};
  }

  for (const v of missing) {
    lines.push(
      `${allowNone ? 'WARNING' : 'REFUSED'}: iOS ${v.versionString} (state=${v.state}) has NO phased release.`,
      '  It would go to 100% of users at once when Apple approves it (TECH_DEBT #188).',
    );
  }
  if (allowNone) {
    lines.push(
      '  --allow-no-phased-release is set, so this check passes. You chose a 100% release.',
    );
    return {exitCode: 0, lines};
  }
  lines.push(
    '  Fix: in App Store Connect, open the version and turn on "Phased Release for',
    '  Automatic Updates". Then run this check again.',
    '  To release to 100% on purpose, add --allow-no-phased-release.',
  );
  return {exitCode: 1, lines};
}

/** The verdict when the check could not run. Exit 2: never a pass, never a refusal. */
export function didNotRun(reason) {
  return {exitCode: 2, lines: [`the check did not run: ${reason}`]};
}

/** The text of a thrown value. A failed `fetch` keeps its reason in `cause`. */
export function errorText(e) {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause && (e.cause.code || e.cause.message);
  return cause ? `${e.message} (${cause})` : e.message;
}

/**
 * Run the whole `status --require` check.
 *
 * `get(path)` returns {status, body} for a path under the API root. It may
 * throw (no key, a network error, a body that is not JSON): any throw ends the
 * check with exit 2, "the check did not run", and never with exit 1, which
 * means "refused".
 */
export async function runRequire(get, {appId, allowNone = false} = {}) {
  try {
    const list = await get(
      `apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=10`,
    );
    if (list.status !== 200 || !Array.isArray(list.body?.data)) {
      return didNotRun(
        `cannot read the App Store versions (HTTP ${list.status})`,
      );
    }
    const versions = [];
    for (const v of list.body.data) {
      const state = v.attributes.appStoreState ?? v.attributes.appVersionState;
      let phased = null;
      if (!isReleasedState(state)) {
        const r = await get(
          `appStoreVersions/${v.id}/appStoreVersionPhasedRelease`,
        );
        if (r.status === 200) {
          phased = r.body?.data ?? null;
        } else if (r.status !== 404) {
          return didNotRun(
            `cannot read the phased release of ${v.attributes.versionString} (HTTP ${r.status})`,
          );
        }
      }
      versions.push({
        versionString: v.attributes.versionString,
        state,
        phased,
      });
    }
    return evaluateRequire(versions, {
      allowNone,
      hasNextPage: Boolean(list.body.links?.next),
    });
  } catch (e) {
    return didNotRun(errorText(e));
  }
}
