/**
 * UserStateProvider — boots the user-state DB, runs the api-v2 → QF migration
 * shim on first authenticated mount, pulls QF state into the local cache, and
 * wires the sync queue's flush scheduler into syncBus.
 *
 * Renders without errors regardless of auth status. Unauthenticated:
 *   - DB still opens (cache is read-only)
 *   - syncBus.setAuthSnapshot('unauthenticated') → side-effect helpers no-op
 *   - No QF network requests
 *
 * Authenticated:
 *   - Pull preferences (`qariah:favoriteReciterIds`, `qariah:defaultReciter`,
 *     `qariah:theme`) and the latest reading session into the local cache.
 *   - Run the migration shim if `@qariah:v2migrationDone` is unset.
 *   - Schedule a sync flush.
 *
 * Sprint 4 (S4.3).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {AppState, Platform, type AppStateStatus} from 'react-native';
import {useAuth} from '@/services/auth';
import {
  initUserStateDb,
  upsertCachedPreference,
  upsertCachedReadingSession,
} from './db';
import {
  registerFlushScheduler,
  setAuthSnapshot,
  notifyDbReady,
} from './syncBus';
import {scheduleSyncFlush, flushSyncQueue} from './syncQueue';
import {getPreference, QARIAH_PREF_KEYS} from './preferences';
import {getLatestReadingSession} from './readingSessions';
// Sprint 14 — `services/userState/migrationShim.ts` fully deleted
// (TECH_DEBT #55). The Sprint 4 seed-to-QF shim was tombstoned in Sprint 13
// (TECH_DEBT #50) after the Sprint 11 R2 v1-restore path superseded it; no
// out-of-tree callers surfaced over a sprint of observation.
import {checkForV1Restore, type RestoreCandidate} from './v1Restore';
import {restoreQfNotesOnce} from './notesRestore';
import {syncQfPostsToLocal} from './postsRestore';
import {V1RestoreModal} from '@/components/auth/V1RestoreModal';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import * as Sentry from '@sentry/react-native';

interface UserStateContextValue {
  isReady: boolean;
  /** Force a flush; returns when the in-flight flush settles. */
  syncNow: () => Promise<void>;
  /**
   * Sprint 11 — pending v1 restore candidate (R2 JSON found after sign-in).
   * `null` when no candidate (404, error, empty, or already-done). UI components
   * consume this via the rendered V1RestoreModal inside this provider; raw
   * access is exposed so Settings → Your Data can trigger a manual retry.
   */
  v1RestoreCandidate: RestoreCandidate | null;
  /** Programmatic re-trigger for the restore check (Settings → Your Data retry). */
  retryV1Restore: () => Promise<void>;
}

const Ctx = createContext<UserStateContextValue | undefined>(undefined);

export function UserStateProvider({children}: {children: React.ReactNode}) {
  const {status} = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [v1RestoreCandidate, setV1RestoreCandidate] =
    useState<RestoreCandidate | null>(null);
  const dbInitRef = useRef<Promise<void> | null>(null);
  const initialPullDoneForUserRef = useRef<string | null>(null);

  const runV1RestoreCheck = useCallback(async (): Promise<void> => {
    try {
      const result = await checkForV1Restore();
      // Emit on EVERY arm — that is the entire point. Until now a quiet
      // dashboard could not distinguish "the check never ran" from "it ran and
      // legitimately found nothing", so a zero meant unobserved, not healthy.
      // Counts exist only on the candidate arm; zeros elsewhere are truthful.
      // `reason`/`http_status` are the closed-set codes assigned in
      // v1Restore.ts — never the free-text `detail` (it can carry the
      // sha256(email) lookup key; see V1RestoreCheckedProps).
      const checkedCounts =
        result.kind === 'candidate'
          ? result.candidate.counts
          : {reciters: 0, surahs: 0, recitations: 0, recitationsWithoutSlug: 0};
      analyticsService.trackV1RestoreChecked({
        platform: Platform.OS,
        kind: result.kind,
        reciters: checkedCounts.reciters,
        surahs: checkedCounts.surahs,
        recitations: checkedCounts.recitations,
        recitations_without_slug: checkedCounts.recitationsWithoutSlug,
        reason:
          result.kind === 'schema-error' || result.kind === 'network-error'
            ? result.reason
            : null,
        http_status:
          result.kind === 'network-error' && result.httpStatus !== undefined
            ? result.httpStatus
            : null,
        // Absent by construction on the two arms that return before the hash
        // is computed, and on `userinfo-failed` (optional there).
        email_hash_preview:
          result.kind === 'already-done' || result.kind === 'no-auth'
            ? null
            : (result.emailHashPreview ?? null),
      });
      if (result.kind === 'candidate') {
        setV1RestoreCandidate(result.candidate);
      } else if (result.kind === 'schema-error') {
        Sentry.captureMessage(`v1Restore schema error: ${result.detail}`, {
          tags: {scope: 'v1-restore'},
          level: 'warning',
        });
      } else if (result.kind === 'network-error') {
        // Silent — user can retry from Settings → Your Data.
        if (__DEV__) console.warn('[v1Restore] network error:', result.detail);
      }
      // 'empty' / 'not-found' / 'already-done' / 'no-auth' — nothing to do.
    } catch (e) {
      Sentry.captureException(e, {tags: {scope: 'v1-restore-check'}});
    }
  }, []);

  // Wire the flush scheduler exactly once.
  useEffect(() => {
    registerFlushScheduler(reason => {
      scheduleSyncFlush(reason);
    });
  }, []);

  // Push auth snapshot to syncBus on every status change.
  useEffect(() => {
    setAuthSnapshot(status);
  }, [status]);

  // Open the DB once on mount; ready state flips when init resolves.
  useEffect(() => {
    if (dbInitRef.current) return;
    dbInitRef.current = (async () => {
      try {
        await initUserStateDb();
        await notifyDbReady();
        setIsReady(true);
        if (__DEV__) console.log('[userState] DB ready');
      } catch (e) {
        console.error('[userState] DB init failed:', e);
        // Leaving isReady=false means side-effects keep buffering. The next
        // app launch tries init again.
      }
    })();
  }, []);

  // On first transition into 'authenticated': pull QF → cache, then migrate.
  // Re-runs whenever a different user signs in (we key by access-token-derived
  // marker; in practice we just re-run on every auth state change).
  useEffect(() => {
    if (!isReady || status !== 'authenticated') return;
    let cancelled = false;
    const userMarker = 'session'; // Sprint 4: per-session marker. v2.x: hash sub claim.
    if (initialPullDoneForUserRef.current === userMarker) return;
    initialPullDoneForUserRef.current = userMarker;
    (async () => {
      try {
        await pullQfStateIntoCache();
        if (cancelled) return;
      } catch (e) {
        if (__DEV__) console.warn('[userState] initial QF pull failed:', e);
      }
      // Sprint 13 (TECH_DEBT #50) — Sprint-4 migration shim removed; it was
      // dead code post-Sprint-11 and added a round-trip on every auth event.
      // Sprint 11 — v1 restore check (idempotent; sets done-flag on terminal states).
      if (!cancelled) await runV1RestoreCheck();
      // Sprint 18 — pull existing QF Notes into local SQLite on first
      // sign-in. Idempotent (gated by sidecar AsyncStorage key).
      if (!cancelled) {
        try {
          const result = await restoreQfNotesOnce();
          if (__DEV__ && result.kind === 'restored') {
            console.log(`[notesRestore] inserted ${result.count} notes`);
          } else if (result.kind === 'error') {
            Sentry.captureMessage(`notesRestore error: ${result.detail}`, {
              tags: {scope: 'notes-restore'},
              level: 'warning',
            });
          }
        } catch (e) {
          Sentry.captureException(e, {tags: {scope: 'notes-restore'}});
        }
      }
      // Sprint 21 round-5.2 — pull existing QR Posts (published
      // reflections) into the local SQLite cache so the Reflections
      // collection includes posts from QuranReflect web / other
      // QF-backed surfaces, not just locally-published ones. The
      // collection-screen `useFocusEffect` also re-runs this so the
      // initial-auth sync timing doesn't matter for correctness; this
      // call just gets the data in before the user navigates.
      if (!cancelled) {
        try {
          const result = await syncQfPostsToLocal();
          if (__DEV__ && result.kind === 'ok') {
            console.log(
              `[postsRestore] matched=${result.matched} created=${result.created} alreadyLinked=${result.alreadyLinked}`,
            );
          } else if (result.kind === 'error') {
            Sentry.captureMessage(`postsRestore error: ${result.detail}`, {
              tags: {scope: 'posts-restore'},
              level: 'warning',
            });
          }
        } catch (e) {
          Sentry.captureException(e, {tags: {scope: 'posts-restore'}});
        }
      }
      if (!cancelled) scheduleSyncFlush('initial-auth-pull');
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, status, runV1RestoreCheck]);

  // Reset the user marker on sign-out so the next sign-in re-pulls.
  useEffect(() => {
    if (status === 'unauthenticated') {
      initialPullDoneForUserRef.current = null;
    }
  }, [status]);

  // Flush on app foreground (catches writes queued while in background).
  useEffect(() => {
    function onAppStateChange(next: AppStateStatus) {
      if (next === 'active' && status === 'authenticated' && isReady) {
        scheduleSyncFlush('app-foreground');
      }
    }
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [status, isReady]);

  const syncNow = useCallback(async () => {
    if (!isReady) return;
    await flushSyncQueue('manual-syncNow');
  }, [isReady]);

  const retryV1Restore = useCallback(async () => {
    // Settings → Your Data path: clears the done-flag (via dynamic import to
    // avoid circular deps at module load) then runs the check again.
    const {clearV1RestoreFlag} = await import('./v1Restore');
    await clearV1RestoreFlag();
    await runV1RestoreCheck();
  }, [runV1RestoreCheck]);

  const dismissV1Restore = useCallback(() => {
    setV1RestoreCandidate(null);
  }, []);

  const value = useMemo<UserStateContextValue>(
    () => ({isReady, syncNow, v1RestoreCandidate, retryV1Restore}),
    [isReady, syncNow, v1RestoreCandidate, retryV1Restore],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <V1RestoreModal
        isVisible={v1RestoreCandidate !== null}
        candidate={v1RestoreCandidate}
        onDone={dismissV1Restore}
      />
    </Ctx.Provider>
  );
}

export function useUserState(): UserStateContextValue {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error('useUserState() must be used inside <UserStateProvider>');
  return ctx;
}

// ────────────────────── Initial QF → cache pull ──────────────────────

async function pullQfStateIntoCache(): Promise<void> {
  // Preferences we care about for this sprint.
  const prefKeys = [
    QARIAH_PREF_KEYS.favoriteReciterIds,
    QARIAH_PREF_KEYS.defaultReciter,
    QARIAH_PREF_KEYS.theme,
    QARIAH_PREF_KEYS.defaultRewayah,
  ];
  await Promise.all(
    prefKeys.map(async key => {
      try {
        const value = await getPreference<string>(key);
        if (value !== null) {
          await upsertCachedPreference(key, value);
        }
      } catch (e) {
        if (__DEV__) console.warn(`[userState] pull ${key} failed:`, e);
      }
    }),
  );

  try {
    const rs = await getLatestReadingSession();
    if (rs) {
      await upsertCachedReadingSession({
        id: rs.id,
        reciterId: rs.reciterId,
        surahNumber: rs.surahNumber,
        ayahNumber: rs.ayahNumber,
        updatedAt: Date.parse(rs.timestamp) || Date.now(),
      });
    }
  } catch (e) {
    if (__DEV__) console.warn('[userState] pull reading_session failed:', e);
  }
}
