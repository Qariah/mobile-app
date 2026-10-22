// @ai-generated
// Qariah (Sprint 48, S48.6): the body of the catalog check, for the
// background task and for the foreground run.
//
// One function, two callers:
// - The background task (`backgroundTask.ts`, `expo-background-task`) passes
//   no catalog. The body reads `catalog-version.json`. When the version is
//   the one of the last check (and nothing was held back, and a snapshot
//   exists), it stops. Else it fetches the catalog and runs `runCatalogCheck`.
// - The foreground run (`backgroundTask.ts` `startQariahNotifications`)
//   passes the network catalog that the app has in memory (no fetch), or
//   passes no catalog when there is no snapshot yet (then it fetches, as the
//   background task does, so the first snapshot is never the bundled catalog).
//
// Before any download, the body checks what can stop a post: MMKV, the
// holdout, the permission, the preferences and the favorites. Each one stops
// the run with its own status, records no version and downloads nothing. A
// holdout user, or a user with no permission, also loses the stored snapshot:
// the first check after a "yes" is a first check, so it never announces the
// recitations of the months without permission.
//
// `backgroundTask.ts` requires this module lazily, so its imports are not on
// the cold-start path. The run never throws: each failure is a status.
import * as Sentry from '@sentry/react-native';
import branding from '@/config/branding';
import type {Reciter} from '@/data/reciterData';
import {SURAHS} from '@/data/surahData';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
import {
  runCatalogCheck,
  type CatalogCheckDeps,
  type CatalogCheckResult,
  type CatalogCheckStatus,
} from './catalogCheck';
import {recordBackgroundRun} from './backgroundRunReport';
import {
  createCatalogSnapshotStore,
  notificationsStorage,
  type CatalogSnapshotStore,
} from './catalogDiff';
import {isNotificationsHoldout} from './holdout';
import {notificationPrefsSource} from './prefsStore';
import type {
  KeyValueStorage,
  NotificationCandidate,
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  Notifier,
} from './types';

/** MMKV (`qariah-notifications`): the `version` of the last catalog check. */
export const LAST_CATALOG_VERSION_KEY = 'last_catalog_version';
/** MMKV: `'1'` when the last check held keys back (so check again, also with the same version). */
export const CATALOG_CHECK_PENDING_KEY = 'catalog_check_pending';

/** The time limit of each fetch (`catalog-version.json`, the catalog). */
export const CATALOG_TASK_FETCH_TIMEOUT_MS = 20_000;
/** The time limit of the wait for the favorites store to read its value. */
export const FAVORITES_HYDRATION_TIMEOUT_MS = 5_000;

export type CatalogTaskSource = 'background' | 'foreground';

/**
 * What a run did. The statuses of `runCatalogCheck`, and:
 * - `already_running`: another run is in flight in this process. Nothing done.
 * - `holdout`: the user is in the holdout (or the arm is unknown). Nothing
 *   downloaded; the stored snapshot is removed.
 * - `no_permission`: notifications are not allowed. Nothing downloaded; the
 *   stored snapshot is removed.
 * - `no_catalog_source`: no catalog URL is configured. Nothing done.
 * - `version_unavailable`: `catalog-version.json` did not load. Nothing done.
 * - `version_unchanged`: the version of the last check, and nothing held back.
 * - `catalog_unavailable`: the catalog did not load, or it is empty.
 * - `favorites_unavailable`: the favorites store did not read its value, so
 *   a followed recitation would get the wrong type. Nothing saved or posted.
 * - `failed`: an unexpected error. Nothing more is known.
 */
export type CatalogTaskStatus =
  | CatalogCheckStatus
  | 'already_running'
  | 'holdout'
  | 'no_permission'
  | 'no_catalog_source'
  | 'version_unavailable'
  | 'version_unchanged'
  | 'catalog_unavailable'
  | 'favorites_unavailable'
  | 'failed';

export interface CatalogTaskResult {
  source: CatalogTaskSource;
  status: CatalogTaskStatus;
  /** The `version` of `catalog-version.json` (background runs that read it). */
  catalogVersion?: number;
  /** The result of `runCatalogCheck`, when it ran. */
  check?: CatalogCheckResult;
  /** The post failed because a text key is in no locale file (a build without the text). */
  textMissing?: boolean;
}

export interface CatalogTaskDeps {
  /**
   * The catalog to check. Given: the foreground run (no fetch, no version).
   * Not given: the background run (read the version, fetch the catalog).
   */
  catalog?: readonly Reciter[];
  /** Default: `notificationsStorage` (MMKV `qariah-notifications`). */
  storage?: KeyValueStorage;
  /** Default: the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Default: `branding.catalogVersionEndpoint`. `null`: none. */
  versionEndpoint?: string | null;
  /** Default: `branding.catalog.liveUrl`. `null`: none. */
  liveUrl?: string | null;
  /** The favorite reciter ids, or `null` when they could not be read. Default: the store. */
  readFavorites?: () => Promise<readonly string[] | null>;
  /** Default: `isNotificationsHoldout()`. */
  isHoldout?: () => boolean;
  /** Default: `createExpoNotifier()`. */
  notifier?: Notifier;
  /**
   * More candidates for the daily notice (the `whats_new` notice, Task 18).
   * When it gives a candidate, the background run checks also with the same
   * catalog version.
   */
  extraCandidates?: () => readonly NotificationCandidate[];
  /** The other deps of `runCatalogCheck` (tests). */
  checkDeps?: Pick<CatalogCheckDeps, 'snapshotStore' | 'prefs' | 'now'>;
  /** Default: `CATALOG_TASK_FETCH_TIMEOUT_MS`. */
  fetchTimeoutMs?: number;
  /**
   * A posted notice. Default: `notification_scheduled` now (foreground), or
   * in the MMKV queue for the next start (background: a headless run has no
   * PostHog client).
   */
  reportPosted?: (
    posted: NotificationCandidate,
    source: CatalogTaskSource,
  ) => void;
}

/** `{version, url?}` of `catalog-version.json` (RFC-010). */
interface CatalogVersionDoc {
  version: number;
  url?: string;
}

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCatalogVersion(
  fetchFn: typeof fetch,
  endpoint: string,
  timeoutMs: number,
): Promise<CatalogVersionDoc | null> {
  try {
    const body = (await fetchJson(fetchFn, endpoint, timeoutMs)) as {
      version?: unknown;
      url?: unknown;
    } | null;
    if (!body || typeof body.version !== 'number') return null;
    if (!Number.isFinite(body.version)) return null;
    return {
      version: body.version,
      ...(typeof body.url === 'string' && body.url ? {url: body.url} : {}),
    };
  } catch {
    return null;
  }
}

async function fetchCatalog(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Reciter[] | null> {
  try {
    const body = await fetchJson(fetchFn, url, timeoutMs);
    return Array.isArray(body) && body.length > 0 ? (body as Reciter[]) : null;
  } catch {
    return null;
  }
}

/**
 * The favorite reciter ids ("follow" = favorite), or `null` when the store
 * did not read its value within `timeoutMs`. The store reads AsyncStorage when
 * it is created; after a failed read it keeps its defaults (no favorite), and
 * `hasHydrated()` stays `false` (`services/storage/hydrationGuardedStorage.ts`).
 */
export async function readFavoriteReciterIds(
  timeoutMs: number = FAVORITES_HYDRATION_TIMEOUT_MS,
): Promise<string[] | null> {
  const {useFavoriteRecitersStore} =
    require('@/services/player/store/favoriteRecitersStore') as typeof import('@/services/player/store/favoriteRecitersStore');
  const persist = useFavoriteRecitersStore.persist;
  if (!persist.hasHydrated()) {
    const hydrated = await new Promise<boolean>(resolve => {
      let unsubscribe: () => void = () => undefined;
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(persist.hasHydrated());
      }, timeoutMs);
      unsubscribe = persist.onFinishHydration(() => {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      });
    });
    if (!hydrated) return null;
  }
  return [...useFavoriteRecitersStore.getState().favoriteReciterIds];
}

function defaultNotifier(): Notifier {
  const {createExpoNotifier} =
    require('./expoNotifier') as typeof import('./expoNotifier');
  return createExpoNotifier();
}

/** The reciter name and the surah name in the app language. */
function formatReciterName(reciter: Reciter): string {
  return getReciterDisplayName(reciter);
}
function formatSurahName(surah: number): string {
  const entry = SURAHS[surah - 1];
  return entry ? getSurahDisplayName(entry) : String(surah);
}

/** The statuses after which the saved snapshot is up to date for this catalog. */
const CHECKED_STATUSES: ReadonlySet<CatalogCheckStatus> = new Set([
  'first_check',
  'nothing_new',
  'not_posted',
  'post_failed',
  'posted',
]);

function safeGet(storage: KeyValueStorage, key: string): string | undefined {
  try {
    return storage.getString(key);
  } catch {
    return undefined;
  }
}

function safeSet(storage: KeyValueStorage, key: string, value: string): void {
  try {
    storage.set(key, value);
  } catch {
    // Best effort: the next run checks again.
  }
}

function safeRemove(storage: KeyValueStorage, key: string): void {
  try {
    storage.remove(key);
  } catch {
    // Best effort.
  }
}

/**
 * Records the version of a completed check, and whether keys wait for a later
 * check. A post that failed for a missing text key does not make keys wait:
 * the text comes only with a new build, so a re-download on each run would
 * change nothing. Its keys stay out of the snapshot, so the next check that
 * runs (a new catalog version, or the foreground check) finds them again.
 */
function recordCheck(
  storage: KeyValueStorage,
  check: CatalogCheckResult,
  version: number | undefined,
  textMissing: boolean,
): void {
  if (!CHECKED_STATUSES.has(check.status)) return;
  if (version !== undefined) {
    safeSet(storage, LAST_CATALOG_VERSION_KEY, String(version));
  }
  const textFailure = check.status === 'post_failed' && textMissing;
  if (check.heldBackKeys.length > 0 && !textFailure) {
    safeSet(storage, CATALOG_CHECK_PENDING_KEY, '1');
  } else {
    safeRemove(storage, CATALOG_CHECK_PENDING_KEY);
  }
}

/** Removes the snapshot and the records of the last check (holdout, no permission). */
function forgetSnapshot(
  storage: KeyValueStorage,
  snapshotStore: CatalogSnapshotStore,
): void {
  snapshotStore.clear();
  safeRemove(storage, LAST_CATALOG_VERSION_KEY);
  safeRemove(storage, CATALOG_CHECK_PENDING_KEY);
}

/** `NotificationTextMissingError` of `expoNotifier.ts`, by name (no import of that module). */
function isTextMissingError(error: unknown): boolean {
  return (
    (error as {name?: unknown} | null)?.name === 'NotificationTextMissingError'
  );
}

/** The notifier, plus a flag for a post that failed on a missing text key. */
function trackTextMissing(base: Notifier): {
  notifier: Notifier;
  textMissing: () => boolean;
} {
  let missing = false;
  return {
    notifier: {
      schedule: async (candidate, trigger) => {
        try {
          return await base.schedule(candidate, trigger);
        } catch (error) {
          if (isTextMissingError(error)) missing = true;
          throw error;
        }
      },
      cancel: id => base.cancel(id),
      cancelByType: type => base.cancelByType(type),
      getPermission: () => base.getPermission(),
    },
    textMissing: () => missing,
  };
}

let warnedTextMissing = false;

async function runOnce(
  source: CatalogTaskSource,
  deps: CatalogTaskDeps,
): Promise<CatalogTaskResult> {
  const storage = deps.storage ?? notificationsStorage;
  const snapshotStore =
    deps.checkDeps?.snapshotStore ?? createCatalogSnapshotStore(storage);

  // What can stop a post comes first: no download for a run that cannot post.
  if (!snapshotStore.isAvailable()) {
    return {source, status: 'storage_unavailable'};
  }
  if ((deps.isHoldout ?? isNotificationsHoldout)()) {
    forgetSnapshot(storage, snapshotStore);
    return {source, status: 'holdout'};
  }
  const tracked = trackTextMissing(deps.notifier ?? defaultNotifier());
  let permission: NotificationPermissionStatus;
  try {
    permission = await tracked.notifier.getPermission();
  } catch {
    return {source, status: 'permission_unavailable'};
  }
  if (permission !== 'granted') {
    forgetSnapshot(storage, snapshotStore);
    return {source, status: 'no_permission'};
  }
  const prefsSource = deps.checkDeps?.prefs ?? notificationPrefsSource;
  let prefs: NotificationPrefsSnapshot | null;
  try {
    prefs = await prefsSource.read();
  } catch {
    prefs = null;
  }
  if (!prefs) return {source, status: 'prefs_unavailable'};
  const favorites = await (deps.readFavorites ?? readFavoriteReciterIds)();
  if (!favorites) return {source, status: 'favorites_unavailable'};

  const extra = deps.extraCandidates?.() ?? [];
  // `null`: no catalog is needed (see the version gate below).
  let reciters: readonly Reciter[] | null | undefined = deps.catalog;
  let catalogVersion: number | undefined;

  if (!reciters) {
    const fetchFn = deps.fetchFn ?? fetch;
    const timeoutMs = deps.fetchTimeoutMs ?? CATALOG_TASK_FETCH_TIMEOUT_MS;
    const endpoint =
      deps.versionEndpoint === undefined
        ? branding.catalogVersionEndpoint
        : deps.versionEndpoint;
    const liveUrl =
      deps.liveUrl === undefined ? branding.catalog.liveUrl : deps.liveUrl;

    let versionUrl: string | undefined;
    if (endpoint) {
      const doc = await fetchCatalogVersion(fetchFn, endpoint, timeoutMs);
      if (!doc) return {source, status: 'version_unavailable'};
      catalogVersion = doc.version;
      versionUrl = doc.url;
      const unchanged =
        safeGet(storage, LAST_CATALOG_VERSION_KEY) === String(doc.version);
      const pending = safeGet(storage, CATALOG_CHECK_PENDING_KEY) === '1';
      if (unchanged && !pending && snapshotStore.load() !== null) {
        if (extra.length === 0) {
          return {source, status: 'version_unchanged', catalogVersion};
        }
        // Only an extra candidate (the announcement) can post, and it needs
        // no catalog: check without a download. `runCatalogCheck` then
        // compares nothing and keeps the stored snapshot.
        reciters = null;
      }
    }
    if (reciters !== null) {
      // As `refetchCatalogToVersion`: the immutable per-version URL first.
      const url = versionUrl ?? liveUrl;
      if (!url) return {source, status: 'no_catalog_source', catalogVersion};
      const fetched = await fetchCatalog(fetchFn, url, timeoutMs);
      if (!fetched)
        return {source, status: 'catalog_unavailable', catalogVersion};
      reciters = fetched;
    }
  }

  const check = await runCatalogCheck({
    reciters: reciters ?? null,
    favoriteReciterIds: favorites,
    // The holdout returned above: a user here is not in it.
    holdout: false,
    notifier: tracked.notifier,
    extraCandidates: extra,
    formatReciterName,
    formatSurahName,
    ...deps.checkDeps,
    snapshotStore,
    prefs: prefsSource,
  });
  const textMissing = check.status === 'post_failed' && tracked.textMissing();
  recordCheck(storage, check, catalogVersion, textMissing);
  if (textMissing && !warnedTextMissing) {
    warnedTextMissing = true;
    if (__DEV__) {
      console.warn(
        '[notifications] a notification text key is in no locale file; ' +
          'the notice waits for a build with the text.',
      );
    }
  }
  return {
    source,
    status: check.status,
    catalogVersion,
    check,
    ...(textMissing ? {textMissing} : {}),
  };
}

/** Logs a run in DEV and leaves one Sentry breadcrumb (no event). */
function report(result: CatalogTaskResult): void {
  const message = `catalog check (${result.source}): ${result.status}`;
  try {
    Sentry.addBreadcrumb({
      category: 'notifications',
      level: 'info',
      message,
      data: {
        ...(result.catalogVersion !== undefined
          ? {catalog_version: result.catalogVersion}
          : {}),
        new_keys: result.check?.newKeys.length ?? 0,
        held_back: result.check?.heldBackKeys.length ?? 0,
        ...(result.check?.posted
          ? {posted_type: result.check.posted.type}
          : {}),
        ...(result.textMissing ? {text_missing: true} : {}),
      },
    });
  } catch {
    // A breadcrumb must not fail the run.
  }
  if (__DEV__) {
    console.log(
      `[notifications] ${message}`,
      result.check
        ? {
            newKeys: result.check.newKeys.length,
            heldBackKeys: result.check.heldBackKeys.length,
            posted: result.check.posted?.dedupeKey ?? null,
          }
        : '',
    );
  }
}

/** The default `reportPosted` (see `CatalogTaskDeps`). */
function reportPostedNotice(
  storage: KeyValueStorage | undefined,
): (posted: NotificationCandidate, source: CatalogTaskSource) => void {
  return (posted, source) => {
    const analytics =
      require('./notificationAnalytics') as typeof import('./notificationAnalytics');
    const props = analytics.scheduledProps(posted, 'immediate', source);
    if (source === 'background') {
      analytics.queueScheduledEvent(props, storage ?? notificationsStorage);
    } else {
      void analytics.trackNotificationScheduled(props);
    }
  };
}

let inFlight: Promise<CatalogTaskResult> | null = null;

/**
 * One catalog check (see the note at the top of this file). One run at a time
 * in each process: a second call while one runs gives `already_running`
 * (on iOS the background task can start while the app runs its foreground
 * check). Never throws.
 */
export async function runQariahCatalogTask(
  source: CatalogTaskSource,
  deps: CatalogTaskDeps = {},
): Promise<CatalogTaskResult> {
  const finish = (result: CatalogTaskResult): CatalogTaskResult => {
    report(result);
    if (result.check?.posted) {
      try {
        (deps.reportPosted ?? reportPostedNotice(deps.storage))(
          result.check.posted,
          source,
        );
      } catch {
        // Analytics must not break the run.
      }
    }
    // Field evidence that the task body runs (`backgroundRunReport.ts`).
    if (source === 'background') {
      recordBackgroundRun(
        deps.storage ?? notificationsStorage,
        result.status,
        deps.checkDeps?.now ?? new Date(),
      );
    }
    return result;
  };
  if (inFlight) return finish({source, status: 'already_running'});
  const run = runOnce(source, deps).catch(
    (): CatalogTaskResult => ({source, status: 'failed'}),
  );
  inFlight = run;
  try {
    return finish(await run);
  } finally {
    inFlight = null;
  }
}
