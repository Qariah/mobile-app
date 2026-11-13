// @ai
//
// scripts/lib/play-release-state.mjs
// ----------------------------------
// The review state of the releases on one Google Play track, from
//   GET androidpublisher/v3/applications/<package>/tracks/<track>/releases
//
// Why: the track that an edit reads (edits/<id>/tracks/<track>) says what the
// developer asked for. It does not say what Google serves. From 2026-11-08 to
// 2026-11-12 the production track said `3763 completed`, the rollout record
// said 100%, and Google Play served build 2027 to every user: release 3763 was
// APPROVED_NOT_PUBLISHED, because "Managed publishing" was on in the Play
// Console and nobody pressed "Publish changes". No tool read this state, so no
// report showed it (planning/android-anr-floor-rca-2026-11-11.md, section 2).

const PREFIX = 'RELEASE_LIFECYCLE_STATE_';

/** States in which Google Play does not serve the release to users. */
export const NOT_LIVE_STATES = [
  'APPROVED_NOT_PUBLISHED',
  'IN_REVIEW',
  'NOT_APPROVED',
  'DRAFT',
];

/**
 * @param {{releases?: Array<{releaseName?: string,
 *   releaseLifecycleState?: string,
 *   activeArtifacts?: Array<{versionCode?: number|string}>}>}} body
 *   the JSON of the releases endpoint
 * @returns {Array<{name: string, versionCodes: string[], state: string,
 *   live: boolean, ownerAction: string|null}>} one row for each release.
 *   `state` has no prefix (UNKNOWN when Google sent none). `ownerAction` is
 *   the text for the owner when only a person can move the release on.
 */
export function releaseStates(body) {
  return (body?.releases ?? []).map(r => {
    const raw = String(r.releaseLifecycleState ?? '');
    const state = raw.startsWith(PREFIX)
      ? raw.slice(PREFIX.length)
      : raw || 'UNKNOWN';
    const versionCodes = (r.activeArtifacts ?? [])
      .map(a => a?.versionCode)
      .filter(v => v !== undefined && v !== null)
      .map(String);
    let ownerAction = null;
    if (state === 'APPROVED_NOT_PUBLISHED') {
      ownerAction =
        'Google approved this release, and Google Play does not serve it. ' +
        'Open the Play Console, "Publishing overview", and press "Publish changes" ' +
        '(or turn "Managed publishing" off).';
    } else if (state === 'NOT_APPROVED') {
      ownerAction =
        'Google rejected this release. Read the reason in the Play Console, "Publishing overview".';
    }
    return {
      name: String(r.releaseName ?? versionCodes.join('+') ?? ''),
      versionCodes,
      state,
      live: state === 'PUBLISHED',
      ownerAction,
    };
  });
}

/** True when a release waits for a person (see `ownerAction`). */
export function needsOwner(rows) {
  return rows.some(r => r.ownerAction !== null);
}
