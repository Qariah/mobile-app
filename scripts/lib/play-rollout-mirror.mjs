// @ai
//
// scripts/lib/play-rollout-mirror.mjs
// -----------------------------------
// The pure rules of scripts/play-rollout-mirror.mjs: no network, no file
// access, so scripts/__tests__/play-rollout-mirror.test.mjs runs them as is.
//
// The mirror gives the Android production release the same reach as the iOS
// phased release of the same version. Apple advances its phased release one
// rung each day (1, 2, 5, 10, 20, 50, 100%) and Play holds a staged rollout at
// the fraction that was last set. So the Android fraction follows the iOS rung:
//   - iOS ACTIVE, day d  → Android at the rung of day d;
//   - iOS COMPLETE       → Android completed (100%);
//   - iOS PAUSED, INACTIVE, no phased release, any other state → Android holds.
// The mirror only raises the fraction. It never lowers it, and it never changes
// a halted, draft or completed release. A pause on iOS
// (`node scripts/asc-phased-release.mjs pause`) therefore holds both platforms.

// Apple's fixed ladder, by day index (the same table as asc-phased-release.mjs).
export const LADDER = [1, 2, 5, 10, 20, 50, 100];

// The Android target for an iOS phased-release state.
// Returns {fraction, complete, reason}: `fraction` is a number in (0, 1], or
// null for "hold"; `complete` is true when Android goes to 100%.
export function iosTarget(phased) {
  if (!phased) {
    return {
      fraction: null,
      complete: false,
      reason: 'iOS has no phased release',
    };
  }
  const st = phased.phasedReleaseState;
  const day = phased.currentDayNumber;
  if (st === 'COMPLETE') {
    return {fraction: 1, complete: true, reason: 'iOS phased release COMPLETE'};
  }
  if (st === 'ACTIVE') {
    if (typeof day !== 'number' || day < 1) {
      return {
        fraction: null,
        complete: false,
        reason: 'iOS ACTIVE with no day counter yet',
      };
    }
    const rung = LADDER[Math.min(day, LADDER.length) - 1];
    return {
      fraction: rung / 100,
      complete: rung === 100,
      reason: `iOS ACTIVE, day ${day} (${rung}%)`,
    };
  }
  if (st === 'PAUSED') {
    return {
      fraction: null,
      complete: false,
      reason: `iOS PAUSED at day ${day ?? '?'}`,
    };
  }
  if (st === 'INACTIVE') {
    return {
      fraction: null,
      complete: false,
      reason: 'iOS phased release not started',
    };
  }
  return {
    fraction: null,
    complete: false,
    reason: `iOS state ${st} is unknown here`,
  };
}

// The release of `versionCode` on a track, or null.
export function findRelease(track, versionCode) {
  const vc = String(versionCode);
  return (
    (track?.releases ?? []).find(r =>
      (r.versionCodes ?? []).map(String).includes(vc),
    ) ?? null
  );
}

// What to do on Android. Returns {action, fraction, reason}, where action is
// 'none' (nothing to change), 'set' (raise the fraction), 'complete', or
// 'done' (the release is completed: the mirror has nothing more to do).
export function planAndroid(target, release) {
  if (!release) {
    return {
      action: 'none',
      fraction: null,
      reason: 'the version code is not on the production track',
    };
  }
  if (release.status === 'completed') {
    return {
      action: 'done',
      fraction: 1,
      reason: 'Android release completed (100%)',
    };
  }
  if (release.status !== 'inProgress') {
    return {
      action: 'none',
      fraction: null,
      reason: `Android release is ${release.status}; the mirror changes only a staged (inProgress) release`,
    };
  }
  const now = Number(release.userFraction);
  if (target.fraction == null) {
    return {action: 'none', fraction: now, reason: `hold: ${target.reason}`};
  }
  if (target.complete) {
    return {action: 'complete', fraction: 1, reason: target.reason};
  }
  // A small margin, because Play returns the fraction as a float.
  if (target.fraction > now + 1e-9) {
    return {action: 'set', fraction: target.fraction, reason: target.reason};
  }
  return {
    action: 'none',
    fraction: now,
    reason: `Android already at ${pct(now)}; ${target.reason}`,
  };
}

// The new production track for a plan. `set` changes only the fraction of the
// matching release and keeps every other release (the completed one that Play
// serves to the rest). `complete` leaves only the matching release, completed.
export function trackForPlan(track, versionCode, plan) {
  const vc = String(versionCode);
  const match = r => (r.versionCodes ?? []).map(String).includes(vc);
  if (plan.action === 'set') {
    return {
      track: track.track,
      releases: track.releases.map(r =>
        match(r) ? {...r, userFraction: plan.fraction} : r,
      ),
    };
  }
  if (plan.action === 'complete') {
    const done = {...track.releases.find(match), status: 'completed'};
    delete done.userFraction;
    return {track: track.track, releases: [done]};
  }
  throw new Error(`no track change for action ${plan.action}`);
}

// The production track after a promotion of `versionCode` from another track
// at `fraction`. It keeps the completed production release, so that Play goes
// on serving it to the users outside the fraction. It refuses while a staged
// rollout is live, because the new release list would end it.
export function promoteTrack({
  production,
  source,
  versionCode,
  fraction,
  notes,
}) {
  if (!(fraction > 0 && fraction < 1)) {
    throw new Error(
      `a staged rollout needs a fraction strictly between 0 and 1, got ${fraction}`,
    );
  }
  const from = findRelease(source, versionCode);
  if (!from)
    throw new Error(
      `version code ${versionCode} is not on the ${source?.track ?? 'source'} track`,
    );
  if (findRelease(production, versionCode)) {
    throw new Error(
      `version code ${versionCode} is already on the production track`,
    );
  }
  const live = (production?.releases ?? []).filter(
    r => r.status === 'inProgress',
  );
  if (live.length) {
    throw new Error(
      `a staged rollout is live on production (${live.map(r => (r.versionCodes ?? []).join(',')).join('; ')}); complete or halt it first`,
    );
  }
  const releaseNotes = notes
    ? [{language: 'en-US', text: notes}]
    : from.releaseNotes;
  const release = {
    name: from.name ?? String(versionCode),
    versionCodes: [String(versionCode)],
    status: 'inProgress',
    userFraction: fraction,
    ...(releaseNotes ? {releaseNotes} : {}),
  };
  const kept = (production?.releases ?? []).filter(
    r => r.status === 'completed',
  );
  return {track: 'production', releases: [release, ...kept]};
}

export function pct(fraction) {
  return fraction == null || Number.isNaN(fraction)
    ? '—'
    : `${Math.round(fraction * 1000) / 10}%`;
}
