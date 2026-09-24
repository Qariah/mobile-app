/**
 * Canonical Qariah user-state schema (QariahUserStateV1).
 *
 * The single source of truth for user data shape across:
 *   - scripts/extract-v1-migration.ts            (writes to R2 migrations/v1/...)
 *   - services/userState/v1Restore.ts            (reads from R2 on first sign-in)
 *   - services/userState/exportImport.ts         (in-app Settings → Your Data)
 *   - Sprint 12 D2 Cloudflare Worker             (server-side state, future)
 *
 * Versioning policy: bump `schemaVersion` on every breaking field-shape change.
 * Importers keep every prior version's migration function (bring-forward only).
 *
 * Sprint 11 (S11.6).
 */

import {z} from 'zod';

// ── Inner record types ─────────────────────────────────────────────────────

export const FavoriteReciterSchema = z.object({
  /** Legacy api-v2 User._id (24-hex Mongo ObjectId). May be empty for v2-native favorites. */
  legacyId: z.string(),
  /** v2 catalog slug, e.g. 'maryam-amir'. May be null if the legacy reciter has no v2 catalog match. */
  slug: z.string().nullable(),
  /** Reciter display name at the time of favoriting (denormalized for portability). */
  name: z.string(),
  /** ISO8601 timestamp the favorite was created. */
  addedAt: z.string(),
});

export const FavoriteSurahSchema = z.object({
  /** Surah number 1–114. */
  surahNumber: z.number().int().min(1).max(114),
  addedAt: z.string(),
});

export const FavoriteRecitationSchema = z.object({
  /** Legacy api-v2 Recitation._id. */
  legacyId: z.string(),
  /** Legacy api-v2 reciter User._id. */
  legacyReciterId: z.string(),
  /** Reciter slug in the v2 catalog (may be null on no match). */
  reciterSlug: z.string().nullable(),
  /** Reciter display name (denormalized). */
  reciterName: z.string(),
  /** Surah number 1–114 (may be null in some legacy data — caller must filter). */
  surahNumber: z.number().int().min(1).max(114).nullable(),
  /** Surah English-ish name, e.g. 'Al-Mulk'. Denormalized. */
  surahName: z.string(),
  /** Narration / rewayah name, e.g. "Hafs A'n Assem". */
  rewayah: z.string(),
  addedAt: z.string(),
});

export const LastPlayedSchema = z.object({
  reciterSlug: z.string(),
  reciterName: z.string(),
  surahNumber: z.number().int().min(1).max(114),
  rewayah: z.string(),
  positionMs: z.number().int().min(0),
  playedAt: z.string(),
});

export const RecentlyPlayedItemSchema = z.object({
  reciterSlug: z.string(),
  reciterName: z.string(),
  surahNumber: z.number().int().min(1).max(114),
  rewayah: z.string(),
  playedAt: z.string(),
});

export const PreferencesSchema = z.object({
  theme: z.enum(['auto', 'light', 'dark']).optional(),
  defaultReciterSlug: z.string().optional(),
  defaultRewayah: z.string().optional(),
});

// ── Top-level envelope ─────────────────────────────────────────────────────

export const QariahUserStateV1Schema = z.object({
  schemaVersion: z.literal(1),

  /** ISO8601 export timestamp. */
  exportedAt: z.string(),

  /** App version that wrote this state, e.g. '3.1.0+872'. Empty string for migration-extractor output. */
  appVersion: z.string(),

  /** Source provenance: who wrote this file. */
  source: z.enum(['v1-extractor', 'v2-export', 'v2-server']),

  favorites: z.object({
    reciters: z.array(FavoriteReciterSchema),
    surahs: z.array(FavoriteSurahSchema),
    recitations: z.array(FavoriteRecitationSchema),
  }),

  lastPlayed: LastPlayedSchema.nullable(),

  preferences: PreferencesSchema,

  recentlyPlayed: z.array(RecentlyPlayedItemSchema).max(20),
});

export type QariahUserStateV1 = z.infer<typeof QariahUserStateV1Schema>;
export type FavoriteReciter = z.infer<typeof FavoriteReciterSchema>;
export type FavoriteSurah = z.infer<typeof FavoriteSurahSchema>;
export type FavoriteRecitation = z.infer<typeof FavoriteRecitationSchema>;
export type LastPlayed = z.infer<typeof LastPlayedSchema>;
export type RecentlyPlayedItem = z.infer<typeof RecentlyPlayedItemSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;

/** Construct an empty canonical state for a fresh user. */
export function emptyQariahUserStateV1(
  source: QariahUserStateV1['source'],
  appVersion = '',
): QariahUserStateV1 {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    source,
    favorites: {reciters: [], surahs: [], recitations: []},
    lastPlayed: null,
    preferences: {},
    recentlyPlayed: [],
  };
}
