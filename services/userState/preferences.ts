/**
 * QF user-data API — Preferences resource (write only).
 *
 * QF preferences are a key-value store. Values are TEXT — for non-string
 * Qariah values (arrays, objects, booleans) we JSON-encode on write.
 * setPreference auto-detects: strings pass through; everything else gets
 * JSON.stringify'd.
 *
 * Qariah-namespaced key in use: `qariah:favoriteReciterIds` (JSON array of
 * reciter slug strings), written by the favourites push in `syncBus.ts`.
 *
 * Endpoint (relative to {apiBase}/auth/v1, composed by the SDK):
 *   POST /preferences            {key, value}  (upsert single)
 *
 * Sprint 4 (S4.1) — original hand-rolled client.
 * Sprint 17 (S17.2) — migrated onto `@quranjs/api/public`.
 * Divergence batch C3 (SEM-S1, 2026-10-24) — the read path
 * (`listPreferences`, `getPreference`) and the unused keys `defaultReciter`,
 * `theme` and `defaultRewayah` were removed: only the removed QF → cache pull
 * read them.
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall} from './qfErrors';

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
