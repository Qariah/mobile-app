/**
 * QF user-data API — Preferences resource.
 *
 * QF preferences are a key-value store. Values are TEXT — for non-string
 * Qariah values (arrays, objects, booleans) we JSON-encode on write and
 * JSON-decode on read. setPreference auto-detects: strings pass through;
 * everything else gets JSON.stringify'd.
 *
 * Qariah-namespaced keys (sprint 4 scope):
 *   qariah:favoriteReciterIds  - JSON array of reciter slug strings
 *   qariah:defaultReciter      - reciter slug (string)
 *   qariah:theme               - theme name (string)
 *   qariah:defaultRewayah      - rewayah identifier (string)
 *
 * Endpoints (relative to {apiBase}/auth/v1, composed by the SDK):
 *   GET  /preferences            (list all)
 *   POST /preferences            {key, value}  (upsert single)
 *   POST /preferences/bulk       {preferences: [...]} (bulk upsert)
 *
 * Sprint 4 (S4.1) — original hand-rolled client. The pre-S17.2 helper
 * used a separate per-key GET (`/preferences/{key}`) which the SDK doesn't
 * expose; we now fetch the full list and filter client-side for
 * `getPreference()`. Preference lists are short (~5–10 keys per user), so
 * the extra bytes are negligible.
 * Sprint 17 (S17.2) — migrated onto `@quranjs/api/public`.
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall, QfApiError} from './qfErrors';

export interface QfPreference {
  key: string;
  value: string;
}

export const QARIAH_PREF_KEYS = {
  favoriteReciterIds: 'qariah:favoriteReciterIds',
  defaultReciter: 'qariah:defaultReciter',
  theme: 'qariah:theme',
  defaultRewayah: 'qariah:defaultRewayah',
} as const;

export type QariahPrefKey =
  (typeof QARIAH_PREF_KEYS)[keyof typeof QARIAH_PREF_KEYS];

interface QfPreferencesListResponse {
  preferences?: unknown;
  data?: unknown;
}

/**
 * Normalize the SDK's `auth.preferences.get()` response (typed as `unknown`)
 * into a flat `QfPreference[]`. Sprint 17 user testing surfaced a brand-new
 * QF account returning a shape where the previous unwrap fell through and
 * left a non-array value in `preferences`/`data`, crashing the downstream
 * `.find()` call with `TypeError: all.find is not a function`.
 *
 * Defensive rules:
 *   1. Already an array of {key, value} → use it.
 *   2. Wrapped envelope with `.preferences` or `.data` array → unwrap.
 *   3. Plain `{key1: val1, key2: val2}` record → entries → array of rows.
 *   4. Anything else → empty array. In __DEV__ log the shape once so we can
 *      characterize what the SDK actually sends.
 */
function unwrapList(res: unknown): QfPreference[] {
  if (Array.isArray(res)) return res as QfPreference[];

  if (res && typeof res === 'object') {
    const r = res as QfPreferencesListResponse;

    // Envelope: {preferences: [...]} or {data: [...]}
    if (Array.isArray(r.preferences)) return r.preferences as QfPreference[];
    if (Array.isArray(r.data)) return r.data as QfPreference[];

    // Sometimes the envelope wraps a hash-map: {preferences: {k: v, ...}}.
    if (r.preferences && typeof r.preferences === 'object') {
      return recordToList(r.preferences as Record<string, unknown>);
    }
    if (r.data && typeof r.data === 'object') {
      return recordToList(r.data as Record<string, unknown>);
    }

    // No envelope: the response is already the {k: v, ...} record.
    // Filter out reserved fields the SDK might inject (e.g. `meta`, `success`).
    const own = Object.keys(r);
    const stringValuesOnly = own.every(k => {
      const v = (r as Record<string, unknown>)[k];
      return typeof v === 'string';
    });
    if (own.length > 0 && stringValuesOnly) {
      return recordToList(r as unknown as Record<string, unknown>);
    }

    if (__DEV__) {
      // One-shot diagnostic so we can characterize the unexpected shape.
      console.warn(
        '[preferences] unrecognised SDK response shape — treating as empty:',
        Object.keys(r),
      );
    }
  }

  return [];
}

function recordToList(rec: Record<string, unknown>): QfPreference[] {
  const out: QfPreference[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === 'string') out.push({key, value});
  }
  return out;
}

export async function listPreferences(): Promise<QfPreference[]> {
  return withQfCall('/preferences', async () => {
    const res = await getQfSdk().auth.preferences.get();
    return unwrapList(res);
  });
}

/**
 * Type-narrow generic getter. `T` defaults to string for the common case;
 * pass an explicit type parameter for JSON-encoded values:
 *   getPreference<string[]>('qariah:favoriteReciterIds')
 *
 * Returns null on missing key — callers should treat this as "use local
 * default". Re-throws other errors for the sync queue to handle.
 *
 * Implementation note: the SDK exposes `auth.preferences.get()` (list-all)
 * and `auth.preferences.update(body)` (write) but no per-key getter. We
 * therefore fetch the full list and filter — acceptable because preference
 * lists are small (~5–10 keys) and `getPreference` is rarely the hot path.
 */
export async function getPreference<T = string>(
  key: string,
): Promise<T | null> {
  let all: QfPreference[];
  try {
    all = await listPreferences();
  } catch (e) {
    if (e instanceof QfApiError && e.status === 404) return null;
    throw e;
  }
  // Belt-and-braces: if `unwrapList` somehow let a non-array through, treat
  // as "no preferences set" rather than crashing the caller (which would
  // bubble the TypeError up to the sync queue and block downstream work
  // like the v1-restore merge).
  if (!Array.isArray(all)) return null;
  const row = all.find(p => p.key === key);
  if (!row) return null;
  // Try JSON-decode; on parse failure, return the raw string. This makes the
  // signature ergonomic for both cases without forcing callers to remember
  // which keys are JSON-encoded.
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

/**
 * Sets a preference. Strings pass through; everything else is JSON-encoded.
 */
export async function setPreference(
  key: string,
  value: unknown,
): Promise<void> {
  const stringValue =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  await withQfCall('/preferences', async () => {
    // QF accepts a {key, value} body for single-pref upsert via the SDK's
    // `update` method (POST /v1/preferences). The SDK passes the body
    // through verbatim.
    await getQfSdk().auth.preferences.update({key, value: stringValue});
  });
}
