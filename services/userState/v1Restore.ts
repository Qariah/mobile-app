/**
 * Sprint 11 — Qariah v1 → v2 one-shot restore.
 *
 * After a successful QF sign-in, this module:
 *
 *   1. Fetches the QF userinfo to get the user's email.
 *   2. Computes sha256(normalize(email)) → R2 key.
 *   3. Fetches the pre-extracted v1 migration JSON from R2 public bucket.
 *   4. Validates against QariahUserStateV1Schema (defensive — extractor pre-validates).
 *   5. Returns a RestoreCandidate the UI can show in V1RestoreModal.
 *   6. When the user confirms, mergeIntoLocalStores() unions v1 favorites
 *      into local zustand stores (useFavoriteRecitersStore, useLovedStore,
 *      plus a new lightweight @qariah:v1FavoriteSurahs AsyncStorage key for
 *      plain-surah favorites that have no v2 UI surface yet).
 *
 * Flag `@qariah:v1RestoreDone` is set on success, on skip, on empty-state,
 * and on 404 — so the flow runs exactly once per device. Network errors and
 * schema-validation failures do NOT set the flag, enabling retry from
 * Settings → Your Data.
 *
 * Pure functions (with side effects scoped to AsyncStorage + zustand) — no
 * React. UI lives in `components/auth/V1RestoreModal.tsx`.
 *
 * Sprint 11 (S11.3).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {digestStringAsync, CryptoDigestAlgorithm, CryptoEncoding} from 'expo-crypto';
import {QariahUserStateV1Schema, type QariahUserStateV1} from './schema';
import {fetchQfUserInfo} from './qfUserInfo';
import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {useLovedStore} from '@/services/player/store/lovedStore';
import {RECITERS, type Reciter, type Rewayat} from '@/data/reciterData';

export const V1_RESTORE_FLAG_KEY = '@qariah:v1RestoreDone';
export const V1_FAVORITE_SURAHS_KEY = '@qariah:v1FavoriteSurahs';
const R2_PUBLIC_HOST_FALLBACK = '';

/** sha256(normalize(email)) — normalize = trim + lowercase. */
export async function emailHashKey(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, normalized, {
    encoding: CryptoEncoding.HEX,
  });
}

function getR2PublicHost(): string {
  // EXPO_PUBLIC_R2_MIGRATION_PUBLIC_HOST is injected at build-time from .env.local.
  // Hardcoded fallback covers the case where the env var didn't make it through.
  return (
    process.env.EXPO_PUBLIC_R2_MIGRATION_PUBLIC_HOST ||
    R2_PUBLIC_HOST_FALLBACK
  );
}

/**
 * The shape returned by checkForV1Restore. The UI uses these counts to populate
 * the V1RestoreModal body copy + decide whether to render the empty-state
 * variant (all counts zero).
 */
export interface RestoreCandidate {
  state: QariahUserStateV1;
  counts: {
    reciters: number;
    surahs: number;
    recitations: number;
    /** Recitations whose reciterSlug is null (can't be merged into lovedStore). */
    recitationsWithoutSlug: number;
  };
  emailHashPreview: string;
}

/**
 * Closed-set, analytics-safe failure code for the two error arms.
 *
 * Assigned at each construction site (where the branch is known exactly) rather
 * than sniffed out of `detail` downstream — string-sniffing an error message is
 * fragile and would silently mis-bucket the moment a message changes.
 *
 * This exists because `detail` is NOT safe to emit to analytics: the
 * `r2 fetch` arm interpolates a fetch error message that can embed the request
 * URL, whose path segment is sha256(email) — the direct lookup key into the
 * public migration bucket — and Zod issue text can echo received values.
 * `detail` stays for Sentry + dev logs; `reason` is what telemetry carries.
 */
export type V1RestoreFailureReason =
  | 'userinfo-failed'
  | 'r2-fetch-failed'
  | 'r2-http-error'
  | 'invalid-json'
  | 'schema-invalid';

/**
 * First 8 hex chars of the sha256(email) lookup key, carried on every arm
 * reached AFTER the hash is computed.
 *
 * Purpose: answer "which blob did we actually look at?" without a manual
 * bucket fetch. A support report of "I had favorites but it found nothing"
 * lands on the `not-found` arm, where the only useful question is whether we
 * looked under the right key — so the preview matters most on the arms that
 * carry no counts at all.
 *
 * Safe to emit: 8 hex chars is 32 of the key's 256 bits, leaving 2^224
 * candidates, so it cannot be turned back into a bucket path. It is a
 * correlation ID — enough to compare against a hash you compute yourself from
 * a known address, not enough to enumerate anyone else's. Never emit the full
 * hash: that IS the path into a public bucket.
 */
export type EmailHashPreview = string;

export type RestoreCheckResult =
  | {
      kind: 'candidate';
      candidate: RestoreCandidate;
      emailHashPreview: EmailHashPreview;
    }
  | {kind: 'empty'; emailHashPreview: EmailHashPreview}
  | {kind: 'not-found'; emailHashPreview: EmailHashPreview}
  // Both arms below return before the hash exists on the `userinfo-failed`
  // path, hence optional rather than required.
  | {kind: 'already-done'}
  | {kind: 'no-auth'}
  | {
      kind: 'schema-error';
      detail: string;
      reason: V1RestoreFailureReason;
      emailHashPreview?: EmailHashPreview;
    }
  | {
      kind: 'network-error';
      detail: string;
      reason: V1RestoreFailureReason;
      /** Present only for `r2-http-error`. Safe to emit (a bare status code). */
      httpStatus?: number;
      emailHashPreview?: EmailHashPreview;
    };

/**
 * Idempotent entry point — called from UserStateContext on first authenticated
 * mount. Returns a result the UI can render. Side effect: sets the flag for
 * terminal-success kinds (empty / not-found / already-done). Does NOT set the
 * flag for candidate (the user hasn't decided yet) or error kinds (allow retry).
 */
export async function checkForV1Restore(): Promise<RestoreCheckResult> {
  const flag = await AsyncStorage.getItem(V1_RESTORE_FLAG_KEY).catch(() => null);
  if (flag) return {kind: 'already-done'};

  let userInfo;
  try {
    userInfo = await fetchQfUserInfo();
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown';
    return {
      kind: 'network-error',
      detail: `userinfo: ${detail}`,
      reason: 'userinfo-failed',
    };
  }
  if (!userInfo) return {kind: 'no-auth'};

  const hash = await emailHashKey(userInfo.email);
  const url = `https://${getR2PublicHost()}/migrations/v1/${hash}.json`;
  // Derived once here so every arm below reports the SAME key it looked under.
  // Recomputing per-arm would risk the two drifting apart, which would defeat
  // the whole point of the field.
  const emailHashPreview = hash.slice(0, 8);

  let res: Response;
  try {
    res = await fetch(url, {method: 'GET'});
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'network';
    return {
      kind: 'network-error',
      detail: `r2 fetch: ${detail}`,
      reason: 'r2-fetch-failed',
      emailHashPreview,
    };
  }

  if (res.status === 404) {
    await AsyncStorage.setItem(V1_RESTORE_FLAG_KEY, '1').catch(() => {});
    return {kind: 'not-found', emailHashPreview};
  }
  if (!res.ok) {
    return {
      kind: 'network-error',
      detail: `r2 ${res.status}`,
      reason: 'r2-http-error',
      httpStatus: res.status,
      emailHashPreview,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      kind: 'schema-error',
      detail: 'invalid JSON in R2 response',
      reason: 'invalid-json',
      emailHashPreview,
    };
  }

  const parsed = QariahUserStateV1Schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      kind: 'schema-error',
      detail,
      reason: 'schema-invalid',
      emailHashPreview,
    };
  }

  const data = parsed.data;
  const recitationsWithoutSlug = data.favorites.recitations.filter(
    (r) => !r.reciterSlug,
  ).length;
  const total =
    data.favorites.reciters.length +
    data.favorites.surahs.length +
    data.favorites.recitations.length;

  if (total === 0) {
    await AsyncStorage.setItem(V1_RESTORE_FLAG_KEY, '1').catch(() => {});
    return {kind: 'empty', emailHashPreview};
  }

  return {
    kind: 'candidate',
    emailHashPreview,
    candidate: {
      state: data,
      counts: {
        reciters: data.favorites.reciters.length,
        surahs: data.favorites.surahs.length,
        recitations: data.favorites.recitations.length,
        recitationsWithoutSlug,
      },
      emailHashPreview,
    },
  };
}

/**
 * Merge a v1 RestoreCandidate into local zustand stores + AsyncStorage.
 *
 * Strategy: **union, never delete**. Existing local entries win on conflict
 * (preserving local `favoritedAt` timestamps); v1 entries that don't conflict
 * are added.
 *
 * Returns merged-count breakdown so the UI can show a confirmation toast.
 *
 * Sets `@qariah:v1RestoreDone = '1'` on success.
 */
export interface RestoreMergeResult {
  recitersAdded: number;
  recitationsAdded: number;
  surahsAdded: number;
  recitersSkippedNoSlug: number;
  recitationsSkippedNoSlug: number;
  /** Sprint 13 — distinct from NoSlug: the v1 row had a slug but no surah number. */
  recitationsSkippedNoSurah: number;
  recitationsSkippedNoReciter: number;
  recitationsSkippedNoRewayat: number;
}

export async function mergeV1IntoLocalStores(
  state: QariahUserStateV1,
): Promise<RestoreMergeResult> {
  const result: RestoreMergeResult = {
    recitersAdded: 0,
    recitationsAdded: 0,
    surahsAdded: 0,
    recitersSkippedNoSlug: 0,
    recitationsSkippedNoSlug: 0,
    recitationsSkippedNoSurah: 0,
    recitationsSkippedNoReciter: 0,
    recitationsSkippedNoRewayat: 0,
  };

  // 1. Reciter favorites — look up v2 Reciter by slug, then add via the
  // batch method so the QF favorites-sync queue gets ONE enqueue with the
  // final list rather than N enqueues (Sprint 13, TECH_DEBT #52).
  const favStore = useFavoriteRecitersStore.getState();
  const recitersToAdd: Reciter[] = [];
  for (const v1r of state.favorites.reciters) {
    const reciter = findReciter(v1r.slug, v1r.name);
    if (!reciter) {
      result.recitersSkippedNoSlug++;
      continue;
    }
    if (favStore.isFavoriteReciter(reciter.id)) continue; // already a favorite
    recitersToAdd.push(reciter);
  }
  result.recitersAdded = favStore.addFavoriteRecitersBatch(recitersToAdd);

  // 2. Recitation favorites — map (slug, surahNumber, rewayah-name) into lovedStore.
  const loved = useLovedStore.getState();
  for (const rec of state.favorites.recitations) {
    if (rec.surahNumber === null) {
      // Sprint 13 — was incorrectly bucketed under recitationsSkippedNoSlug
      // (review caught the mismatch — slug is present here, surah is the
      // missing field). Schema allows null; extractor filters; defensive
      // guard.
      result.recitationsSkippedNoSurah++;
      continue;
    }
    // Sprint 17 — null reciterSlug + intact reciterName is common (the v1
    // extractor sometimes failed to map legacyReciterId → slug). Pass both
    // to the resolver so the name-fallback can recover those rows.
    const reciter = findReciter(rec.reciterSlug, rec.reciterName);
    if (!reciter) {
      if (!rec.reciterSlug) result.recitationsSkippedNoSlug++;
      else result.recitationsSkippedNoReciter++;
      continue;
    }
    const rewayat = findRewayatByName(reciter, rec.rewayah);
    if (!rewayat) {
      result.recitationsSkippedNoRewayat++;
      continue;
    }
    const surahId = String(rec.surahNumber);
    if (loved.isLovedWithRewayat(reciter.id, surahId, rewayat.id)) continue;
    loved.toggleLoved(reciter.id, surahId, rewayat.id);
    result.recitationsAdded++;
  }

  // 3. Plain surah favorites — no v2 UI; persist them to a sidecar AsyncStorage
  // key so future UI work can surface them without re-running the migration.
  if (state.favorites.surahs.length > 0) {
    try {
      const existingRaw = await AsyncStorage.getItem(V1_FAVORITE_SURAHS_KEY);
      const existing: Array<{surahNumber: number; addedAt: string}> = existingRaw
        ? JSON.parse(existingRaw)
        : [];
      const have = new Set(existing.map((e) => e.surahNumber));
      for (const s of state.favorites.surahs) {
        if (have.has(s.surahNumber)) continue;
        existing.push(s);
        result.surahsAdded++;
      }
      await AsyncStorage.setItem(
        V1_FAVORITE_SURAHS_KEY,
        JSON.stringify(existing),
      );
    } catch {
      // If AsyncStorage is full or corrupt, the data is lost — but the user's
      // reciter + recitation favorites already merged successfully. Don't fail.
    }
  }

  // Mark the migration done.
  await AsyncStorage.setItem(V1_RESTORE_FLAG_KEY, '1').catch(() => {});
  return result;
}

/** Mark the migration done WITHOUT merging (user tapped Skip). */
export async function skipV1Restore(): Promise<void> {
  await AsyncStorage.setItem(V1_RESTORE_FLAG_KEY, '1').catch(() => {});
}

/** Clear the done-flag — used by Settings → Your Data → "Retry restore". */
export async function clearV1RestoreFlag(): Promise<void> {
  await AsyncStorage.removeItem(V1_RESTORE_FLAG_KEY).catch(() => {});
}

/** Has the flag been set already on this device? */
export async function isV1RestoreDone(): Promise<boolean> {
  const flag = await AsyncStorage.getItem(V1_RESTORE_FLAG_KEY).catch(() => null);
  return flag === '1';
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sprint 17 user test surfaced: 63/67 catalog reciters have empty `slug`
 * fields after the Sprint-16 ops-console rewrites. v1 favorites store
 * reciters by their original kebab-case slug (`safa-ghoulem`, etc.), so
 * `RECITERS.find(r => r.slug === slug)` returns undefined for nearly
 * every match and v1-restore silently filters everything out.
 *
 * Defence: when the exact slug match fails, fall back to deriving a slug
 * from `Reciter.name` (`Safa Ghoulem` → `safa-ghoulem`) and matching on
 * that. This is robust against the catalog data drift and matches the
 * canonical slug shape the v1 extractor used. The proper long-term fix
 * is to backfill the catalog slugs (and have the ops console always
 * write them), tracked as a follow-up.
 */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Locate a v2 catalog reciter from a v1 (slug, name) pair. Both fields can be
 * unreliable independently — catalog slugs are empty for ~63/67 rows after the
 * Sprint-16 ops-console rewrites; v1 slugs sometimes truncate the full name
 * (`muna-abdifatar` instead of `muna-abdifatar-abdifarah`); some v1
 * recitations carry `reciterSlug: null` while keeping the reciter name intact.
 *
 * Resolution order:
 *   1. Exact slug match (cheapest, correct for the 4/67 rows with slugs).
 *   2. nameToSlug(catalog.name) === v1 slug — catches the catalog-slug-drift
 *      case for `safa-ghoulem`-style v1 slugs.
 *   3. nameToSlug(v1.name) === nameToSlug(catalog.name) — catches v1
 *      slug-truncation (`muna-abdifatar` → matches "Muna Abdifatar Abdifarah")
 *      AND the null-slug-but-name-present case.
 */
function findReciter(
  slug: string | null | undefined,
  name?: string | null,
): Reciter | undefined {
  if (slug) {
    const direct = RECITERS.find((r) => r.slug === slug);
    if (direct) return direct;
    const byCatalogName = RECITERS.find((r) => nameToSlug(r.name ?? '') === slug);
    if (byCatalogName) return byCatalogName;
  }
  if (name) {
    const v1NameSlug = nameToSlug(name);
    if (v1NameSlug) {
      return RECITERS.find((r) => nameToSlug(r.name ?? '') === v1NameSlug);
    }
  }
  return undefined;
}

function findRewayatByName(
  reciter: Reciter,
  name: string,
): Rewayat | undefined {
  // Sprint 17 user test: v1 recitations sometimes carry `rewayah: ''` — the
  // earlier v1 schema didn't always pin a narration. Treat empty/missing as
  // "use the reciter's first rewayat" so the recitation still lands instead
  // of being silently dropped to recitationsSkippedNoRewayat.
  if (!name || !name.trim()) {
    return reciter.rewayat[0];
  }
  // Try exact match first, then case-insensitive fallback (v1 has casual casing).
  return (
    reciter.rewayat.find((r) => r.name === name) ??
    reciter.rewayat.find((r) => r.name.toLowerCase() === name.toLowerCase()) ??
    reciter.rewayat[0]
  );
}

