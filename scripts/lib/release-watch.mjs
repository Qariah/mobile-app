// @ai
//
// scripts/lib/release-watch.mjs
// -----------------------------
// Pure rules for the RELEASE WATCH section of scripts/daily-card.mjs.
//
// The card lists each new build that no issue names as its fix build. On the
// Mac, "new" means "joined engagement.buildsToWatch in the last 14 days", and
// the date comes from the git history of docs/operations/active-rollout.json.
// A Claude Cloud clone is shallow, so that history is missing. The old
// fallback ("every build above the Android production build") listed builds
// that shipped weeks ago, for example 1718 (the iOS production build) and 1726
// (first cloud shadow run, 2026-09-27). shallowWatchBuilds() is the
// replacement: only a build that the file records as shipped, and that is
// above the production build of BOTH platforms.

/**
 * The production build of each platform, as the rollout file records it.
 *   android — the top-level `build` (a versionCode)
 *   ios     — the `+<build>` suffix of `sentryReleaseIos`
 * @returns {{android:number, ios:number} | null} null when either is missing
 */
export function productionBuilds(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const android = Number(cfg.build);
  const m = String(cfg.sentryReleaseIos || '').match(/\+(\d+)$/);
  const ios = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(android) || android <= 0) return null;
  if (!Number.isInteger(ios) || ios <= 0) return null;
  return {android, ios};
}

/**
 * The builds to check when the git history cannot date them.
 * A build qualifies when:
 *   - the file records it as shipped (it is in engagement.buildsToWatch,
 *     which holds "every build actually in users' hands"), and
 *   - it is greater than the production build of either platform.
 * @returns {string[] | null} null when the file cannot answer; the caller
 *   then prints no build lines (never a wrong list)
 */
export function shallowWatchBuilds(cfg) {
  const prod = productionBuilds(cfg);
  const shipped = cfg && cfg.engagement && cfg.engagement.buildsToWatch;
  if (!prod || !Array.isArray(shipped)) return null;
  const floor = Math.max(prod.android, prod.ios);
  return shipped.map(String).filter(b => /^\d+$/.test(b) && Number(b) > floor);
}
