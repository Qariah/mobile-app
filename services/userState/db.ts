/**
 * SQLite write-through cache + offline write queue for QF user-state.
 *
 * Pattern mirrors services/database/DatabaseService.ts: a module-level db
 * handle, idempotent init mutex, WAL mode for concurrent reads.
 *
 * Database file: `userState.db`. Kept separate from `playlists.db` so schema
 * evolution doesn't risk corrupting playlists. The `meta` table holds
 * `schema_version` (added day-one — Sprint 3 retro recommendation).
 *
 * Schema v1 tables:
 *   - meta                    : key/value (schema_version, etc.)
 *   - sync_queue              : pending QF writes (offline + retry)
 *   - cache_preferences       : local mirror of QF preferences
 *   - cache_reading_sessions  : local mirror of QF reading sessions
 *   - cache_bookmarks         : local mirror of QF bookmarks
 *
 * Sprint 4 (S4.2).
 */

import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

export const USER_STATE_DB_NAME = 'userState.db';
export const SCHEMA_VERSION = 1;

export type SyncResource =
  | 'preference'
  | 'reading_session'
  | 'collection'
  | 'bookmark';
export type SyncOperation = 'create' | 'update' | 'delete';

export interface SyncQueueRow {
  id: string;
  resource: SyncResource;
  operation: SyncOperation;
  /** JSON-encoded payload — shape depends on `resource`. */
  payload: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}

export interface CachedPreference {
  key: string;
  value: string;
  syncedAt: number;
}

export interface CachedReadingSession {
  id: string;
  reciterId: string | null;
  surahNumber: number | null;
  ayahNumber: number | null;
  updatedAt: number;
}

export interface CachedBookmark {
  id: string;
  collectionId: string | null;
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  syncedAt: number;
}

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Idempotent open + migrate. Safe to call multiple times concurrently.
 */
export function initUserStateDb(): Promise<void> {
  if (db) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      db = await SQLite.openDatabaseAsync(USER_STATE_DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await createTables(db);
      await applyMigrations(db);
    } catch (e) {
      // Reset so a subsequent call can retry.
      db = null;
      initPromise = null;
      throw e;
    }
  })();
  return initPromise;
}

async function createTables(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          TEXT PRIMARY KEY,
      resource    TEXT NOT NULL,
      operation   TEXT NOT NULL,
      payload     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at
      ON sync_queue(created_at);
    CREATE TABLE IF NOT EXISTS cache_preferences (
      key       TEXT PRIMARY KEY,
      value     TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cache_reading_sessions (
      id           TEXT PRIMARY KEY,
      reciter_id   TEXT,
      surah_number INTEGER,
      ayah_number  INTEGER,
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cache_bookmarks (
      id            TEXT PRIMARY KEY,
      collection_id TEXT,
      verse_key     TEXT NOT NULL,
      surah_number  INTEGER NOT NULL,
      ayah_number   INTEGER NOT NULL,
      synced_at     INTEGER NOT NULL
    );
  `);
}

interface MetaRow {
  value: string;
}

async function applyMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<MetaRow>(
    `SELECT value FROM meta WHERE key = 'schema_version'`,
  );
  const current = row ? parseInt(row.value, 10) : 0;
  if (current === SCHEMA_VERSION) return;

  // Future migrations chain ALTERs here, fenced by `if (current < N)`.
  // No migrations needed for v1 (initial schema).

  await database.runAsync(
    `INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)`,
    [String(SCHEMA_VERSION)],
  );
}

function requireDb(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error(
      'userState DB not initialized — call initUserStateDb() first',
    );
  }
  return db;
}

// ─────────────────────────── Sync queue ────────────────────────────

export interface EnqueueInput {
  resource: SyncResource;
  operation: SyncOperation;
  /** Will be JSON.stringify'd before storage. */
  payload: unknown;
}

export async function enqueueWrite(input: EnqueueInput): Promise<string> {
  const database = requireDb();
  const id = Crypto.randomUUID();
  await database.runAsync(
    `INSERT INTO sync_queue (id, resource, operation, payload, created_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [
      id,
      input.resource,
      input.operation,
      JSON.stringify(input.payload),
      Date.now(),
    ],
  );
  return id;
}

interface SyncQueueDbRow {
  id: string;
  resource: string;
  operation: string;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

function mapSyncQueueRow(r: SyncQueueDbRow): SyncQueueRow {
  return {
    id: r.id,
    resource: r.resource as SyncResource,
    operation: r.operation as SyncOperation,
    payload: r.payload,
    createdAt: r.created_at,
    attempts: r.attempts,
    lastError: r.last_error,
  };
}

export async function dequeueWrites(limit = 50): Promise<SyncQueueRow[]> {
  const database = requireDb();
  const rows = await database.getAllAsync<SyncQueueDbRow>(
    `SELECT id, resource, operation, payload, created_at, attempts, last_error
     FROM sync_queue
     WHERE attempts < 3
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map(mapSyncQueueRow);
}

export async function markWriteComplete(id: string): Promise<void> {
  const database = requireDb();
  await database.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
}

export async function markWriteFailed(
  id: string,
  error: string,
): Promise<void> {
  const database = requireDb();
  await database.runAsync(
    `UPDATE sync_queue
     SET attempts = attempts + 1, last_error = ?
     WHERE id = ?`,
    [error.slice(0, 500), id],
  );
}

export async function getQueueDepth(): Promise<number> {
  const database = requireDb();
  const row = await database.getFirstAsync<{count: number}>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE attempts < 3`,
  );
  return row?.count ?? 0;
}

/**
 * Coalesces queued writes for a given (resource, operation, key) tuple. The
 * preferences resource is the obvious candidate: rapid favorites toggles
 * shouldn't queue 10 writes — only the latest matters. Caller passes a
 * coalesce-key extracted from the payload; rows older than the new one with
 * the same key are deleted before insert.
 *
 * No-op if no matching rows exist.
 */
export async function coalescePreferenceWrite(key: string): Promise<void> {
  const database = requireDb();
  // Delete pending preference writes for the same key — newest will be
  // inserted by the next enqueueWrite() call.
  await database.runAsync(
    `DELETE FROM sync_queue
     WHERE resource = 'preference'
       AND attempts = 0
       AND json_extract(payload, '$.key') = ?`,
    [key],
  );
}

// ─────────────────────────── Cache: preferences ────────────────────────────

interface CachedPreferenceDbRow {
  key: string;
  value: string;
  synced_at: number;
}

export async function getCachedPreference(
  key: string,
): Promise<CachedPreference | null> {
  const database = requireDb();
  const row = await database.getFirstAsync<CachedPreferenceDbRow>(
    `SELECT key, value, synced_at FROM cache_preferences WHERE key = ?`,
    [key],
  );
  if (!row) return null;
  return {key: row.key, value: row.value, syncedAt: row.synced_at};
}

export async function upsertCachedPreference(
  key: string,
  value: string,
): Promise<void> {
  const database = requireDb();
  await database.runAsync(
    `INSERT INTO cache_preferences (key, value, synced_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, synced_at = excluded.synced_at`,
    [key, value, Date.now()],
  );
}

// ─────────────────────────── Cache: reading sessions ───────────────────────

interface CachedReadingSessionDbRow {
  id: string;
  reciter_id: string | null;
  surah_number: number | null;
  ayah_number: number | null;
  updated_at: number;
}

export async function getCachedReadingSession(): Promise<CachedReadingSession | null> {
  const database = requireDb();
  const row = await database.getFirstAsync<CachedReadingSessionDbRow>(
    `SELECT id, reciter_id, surah_number, ayah_number, updated_at
     FROM cache_reading_sessions
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  if (!row) return null;
  return {
    id: row.id,
    reciterId: row.reciter_id,
    surahNumber: row.surah_number,
    ayahNumber: row.ayah_number,
    updatedAt: row.updated_at,
  };
}

export async function upsertCachedReadingSession(
  session: CachedReadingSession,
): Promise<void> {
  const database = requireDb();
  await database.runAsync(
    `INSERT INTO cache_reading_sessions (id, reciter_id, surah_number, ayah_number, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       reciter_id = excluded.reciter_id,
       surah_number = excluded.surah_number,
       ayah_number = excluded.ayah_number,
       updated_at = excluded.updated_at`,
    [
      session.id,
      session.reciterId,
      session.surahNumber,
      session.ayahNumber,
      session.updatedAt,
    ],
  );
}

// ─────────────────────────── Cache: bookmarks ──────────────────────────────

interface CachedBookmarkDbRow {
  id: string;
  collection_id: string | null;
  verse_key: string;
  surah_number: number;
  ayah_number: number;
  synced_at: number;
}

export async function getCachedBookmarks(): Promise<CachedBookmark[]> {
  const database = requireDb();
  const rows = await database.getAllAsync<CachedBookmarkDbRow>(
    `SELECT id, collection_id, verse_key, surah_number, ayah_number, synced_at
     FROM cache_bookmarks
     ORDER BY synced_at DESC`,
  );
  return rows.map(r => ({
    id: r.id,
    collectionId: r.collection_id,
    verseKey: r.verse_key,
    surahNumber: r.surah_number,
    ayahNumber: r.ayah_number,
    syncedAt: r.synced_at,
  }));
}

export async function upsertCachedBookmark(b: CachedBookmark): Promise<void> {
  const database = requireDb();
  await database.runAsync(
    `INSERT INTO cache_bookmarks (id, collection_id, verse_key, surah_number, ayah_number, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       collection_id = excluded.collection_id,
       verse_key = excluded.verse_key,
       surah_number = excluded.surah_number,
       ayah_number = excluded.ayah_number,
       synced_at = excluded.synced_at`,
    [b.id, b.collectionId, b.verseKey, b.surahNumber, b.ayahNumber, b.syncedAt],
  );
}

export async function deleteCachedBookmark(id: string): Promise<void> {
  const database = requireDb();
  await database.runAsync(`DELETE FROM cache_bookmarks WHERE id = ?`, [id]);
}

/**
 * Test-only / dev helper: wipes the DB. Don't ship a settings hook for this.
 */
export async function _resetUserStateDb(): Promise<void> {
  const database = requireDb();
  await database.execAsync(`
    DELETE FROM sync_queue;
    DELETE FROM cache_preferences;
    DELETE FROM cache_reading_sessions;
    DELETE FROM cache_bookmarks;
  `);
}
