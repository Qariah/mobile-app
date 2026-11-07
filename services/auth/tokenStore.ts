/**
 * SecureStore-backed token persistence for QF OAuth.
 *
 * Uses expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on
 * Android). Tokens live across app launches and survive backups depending on
 * platform defaults — we explicitly pin `keychainAccessible: AFTER_FIRST_UNLOCK`
 * on iOS so audio playback can refresh tokens in the background.
 *
 * One row per field; no JSON-blobbing. Keeps individual reads cheap and lets
 * us update single fields (e.g. just the access_token after refresh) without
 * marshalling the whole record.
 */

import * as SecureStore from 'expo-secure-store';

// Key prefix bumped to `v2` during Sprint 5 S5.1 to invalidate any access
// tokens issued before the scope set was widened to QF's dotted child scopes
// (preference.read, reading_session.read, etc.). Old-scope tokens 403 silently
// against /preferences and /reading-sessions; bumping the prefix makes them
// invisible to loadTokens() and forces a fresh sign-in.
//
// Future scope changes that should force re-authentication: bump the version.
const KEY_ACCESS = 'qariah.auth.v2.access_token';
const KEY_REFRESH = 'qariah.auth.v2.refresh_token';
const KEY_ID_TOKEN = 'qariah.auth.v2.id_token';
const KEY_EXPIRES_AT = 'qariah.auth.v2.expires_at_ms'; // unix ms

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** Unix ms timestamp when accessToken stops being valid. */
  expiresAt: number;
}

export async function saveTokens(t: AuthTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS, t.accessToken, STORE_OPTIONS),
    t.refreshToken
      ? SecureStore.setItemAsync(KEY_REFRESH, t.refreshToken, STORE_OPTIONS)
      : SecureStore.deleteItemAsync(KEY_REFRESH),
    t.idToken
      ? SecureStore.setItemAsync(KEY_ID_TOKEN, t.idToken, STORE_OPTIONS)
      : SecureStore.deleteItemAsync(KEY_ID_TOKEN),
    SecureStore.setItemAsync(
      KEY_EXPIRES_AT,
      String(t.expiresAt),
      STORE_OPTIONS,
    ),
  ]);
}

export async function loadTokens(): Promise<AuthTokens | null> {
  const [access, refresh, idToken, expiresAtRaw] = await Promise.all([
    SecureStore.getItemAsync(KEY_ACCESS),
    SecureStore.getItemAsync(KEY_REFRESH),
    SecureStore.getItemAsync(KEY_ID_TOKEN),
    SecureStore.getItemAsync(KEY_EXPIRES_AT),
  ]);
  if (!access || !expiresAtRaw) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;
  return {
    accessToken: access,
    refreshToken: refresh,
    idToken,
    expiresAt,
  };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS),
    SecureStore.deleteItemAsync(KEY_REFRESH),
    SecureStore.deleteItemAsync(KEY_ID_TOKEN),
    SecureStore.deleteItemAsync(KEY_EXPIRES_AT),
  ]);
}
