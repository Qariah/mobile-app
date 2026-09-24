/**
 * Sprint 11 — Export + Import for Settings → Your Data.
 *
 * Export: snapshot the device's local stores into a QariahUserStateV1 JSON
 * payload, write to the cache directory, and share via the system share sheet.
 *
 * Import: pick a JSON file, validate against QariahUserStateV1Schema, return
 * a candidate the UI can preview before merging. The merge reuses the same
 * `mergeV1IntoLocalStores()` path the R2 restore uses — `source` field
 * doesn't change the merge logic.
 *
 * Sprint 11 (S11.5).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  emptyQariahUserStateV1,
  QariahUserStateV1Schema,
  type QariahUserStateV1,
} from './schema';
import {V1_FAVORITE_SURAHS_KEY, mergeV1IntoLocalStores} from './v1Restore';
import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {useLovedStore} from '@/services/player/store/lovedStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {RECITERS} from '@/data/reciterData';
import Constants from 'expo-constants';

const EXPORT_FILENAME_PREFIX = 'qariah-export';

/** Build a QariahUserStateV1 from local stores. */
export async function buildExportState(): Promise<QariahUserStateV1> {
  const appVersion = (Constants.expoConfig?.version ?? '') as string;
  const state = emptyQariahUserStateV1('v2-export', appVersion);

  // Reciter favorites — read directly from zustand.
  const favStore = useFavoriteRecitersStore.getState();
  for (const fav of favStore.getFavoriteReciters()) {
    state.favorites.reciters.push({
      legacyId: '', // v2-native favorite — no api-v2 _id
      slug: fav.slug ?? null,
      name: fav.name,
      addedAt: new Date(fav.favoritedAt).toISOString(),
    });
  }

  // Recitation favorites — look up the reciter slug + rewayah name by id for
  // round-trip portability. Lossy: if the reciter is removed from the catalog
  // between export and import, the recitation can't be re-located on the other
  // side.
  const lovedStore = useLovedStore.getState();
  for (const lv of lovedStore.getLovedTracks()) {
    const reciter = RECITERS.find(r => r.id === lv.reciterId);
    const rewayat = reciter?.rewayat.find(rw => rw.id === lv.rewayatId);
    const surahNumber = Number(lv.surahId);
    if (
      !Number.isInteger(surahNumber) ||
      surahNumber < 1 ||
      surahNumber > 114
    ) {
      continue;
    }
    state.favorites.recitations.push({
      legacyId: '',
      legacyReciterId: '',
      reciterSlug: reciter?.slug ?? null,
      reciterName: reciter?.name ?? '',
      surahNumber,
      surahName: '',
      rewayah: rewayat?.name ?? '',
      addedAt: new Date(lv.timestamp).toISOString(),
    });
  }

  // Plain surah favorites — the sidecar AsyncStorage key seeded by the v1
  // restore. Future v2 UI may also write to it.
  try {
    const raw = await AsyncStorage.getItem(V1_FAVORITE_SURAHS_KEY);
    if (raw) {
      const list: Array<{surahNumber: number; addedAt: string}> =
        JSON.parse(raw);
      for (const s of list) {
        if (
          typeof s.surahNumber === 'number' &&
          s.surahNumber >= 1 &&
          s.surahNumber <= 114 &&
          typeof s.addedAt === 'string'
        ) {
          state.favorites.surahs.push({
            surahNumber: s.surahNumber,
            addedAt: s.addedAt,
          });
        }
      }
    }
  } catch {
    // ignore — no surah favorites is a valid export.
  }

  // Last-played + recently-played — read head of recentlyPlayedStore.
  // Schema's LastPlayed requires non-null surahNumber + reciterSlug; if we
  // can't satisfy, omit (lastPlayed stays null).
  const recent = useRecentlyPlayedStore.getState();
  for (const t of recent.recentTracks.slice(0, 20)) {
    const reciter = RECITERS.find(r => r.id === t.reciter?.id);
    if (!reciter || !reciter.slug) continue;
    const surahNumber = Number(t.surah?.id);
    if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114)
      continue;
    const rewayat = reciter.rewayat.find(rw => rw.id === t.rewayatId);
    state.recentlyPlayed.push({
      reciterSlug: reciter.slug,
      reciterName: reciter.name,
      surahNumber,
      rewayah: rewayat?.name ?? '',
      playedAt: new Date(t.timestamp ?? Date.now()).toISOString(),
    });
  }
  const head = recent.recentTracks[0];
  if (head) {
    const reciter = RECITERS.find(r => r.id === head.reciter?.id);
    const surahNumber = Number(head.surah?.id);
    if (
      reciter?.slug &&
      Number.isInteger(surahNumber) &&
      surahNumber >= 1 &&
      surahNumber <= 114
    ) {
      const rewayat = reciter.rewayat.find(rw => rw.id === head.rewayatId);
      state.lastPlayed = {
        reciterSlug: reciter.slug,
        reciterName: reciter.name,
        surahNumber,
        rewayah: rewayat?.name ?? '',
        positionMs: Math.max(0, Math.floor((head.progress ?? 0) * 1000)),
        playedAt: new Date(head.timestamp ?? Date.now()).toISOString(),
      };
    }
  }

  return state;
}

export interface ExportResult {
  filename: string;
  uri: string;
  payloadBytes: number;
}

/** Write the export to a cache file and open the share sheet. Returns metadata. */
export async function exportAndShare(): Promise<ExportResult> {
  const state = await buildExportState();
  const json = JSON.stringify(state, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${EXPORT_FILENAME_PREFIX}-${stamp}.json`;

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('No cache directory available');
  const uri = `${cacheDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your Qariah data',
      UTI: 'public.json',
    });
  }

  return {filename, uri, payloadBytes: json.length};
}

export interface ImportCandidate {
  state: QariahUserStateV1;
  counts: {
    reciters: number;
    surahs: number;
    recitations: number;
  };
  exportedAt: string;
  source: QariahUserStateV1['source'];
}

export type ImportPickResult =
  | {kind: 'candidate'; candidate: ImportCandidate}
  | {kind: 'cancelled'}
  | {kind: 'read-error'; detail: string}
  | {kind: 'schema-error'; detail: string};

/** Open the document picker, read the JSON, validate it, return a candidate. */
export async function pickAndValidateImport(): Promise<ImportPickResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return {kind: 'cancelled'};
  }

  const asset = picked.assets[0];
  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (e) {
    return {
      kind: 'read-error',
      detail: e instanceof Error ? e.message : 'read failed',
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {kind: 'schema-error', detail: "This doesn't look like a JSON file"};
  }

  const parsed = QariahUserStateV1Schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map(i => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {kind: 'schema-error', detail};
  }

  const data = parsed.data;
  return {
    kind: 'candidate',
    candidate: {
      state: data,
      counts: {
        reciters: data.favorites.reciters.length,
        surahs: data.favorites.surahs.length,
        recitations: data.favorites.recitations.length,
      },
      exportedAt: data.exportedAt,
      source: data.source,
    },
  };
}

/** Commit an import candidate by reusing the v1 restore merge path. */
export async function commitImport(state: QariahUserStateV1) {
  return mergeV1IntoLocalStores(state);
}
