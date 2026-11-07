// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #70): the audio URL of one recitation.
//
// A rewaya keeps its audio files in the folder of its `server` URL:
//
//   full surah, or legacy partial   {server}/{surah-padded}.mp3
//   partial with audio_path         {server}/{surah-padded}-{from}-{to}.mp3
//
// The ops console (qariah-ops-console `functions/_lib/audio-keys.ts`,
// `canonicalKey`) writes the second key for a partial upload. The surah has
// three digits; `from` and `to` have no padding. The app uses the second key
// only when the catalog entry has `audio_path: 'suffixed'`, so every other
// entry keeps its URL.
//
// All the builders of a recitation URL call this function:
// `generateAudioUrl` (utils/audioUtils.ts, the queue and the restore),
// `resolveMushafAudioUrl` (utils/mushafAudioUtils.ts, the Mushaf player) and
// `fetchAudioUrl` (services/dataService.ts, the download).
import type {Rewayat, SurahMetadata} from '@/data/reciterData';

/**
 * The ayah range of the suffixed file, or undefined when the audio is at the
 * unsuffixed path. Uses the first `surah_metadata` entry of the surah, as
 * `getSurahMetadataSync` does.
 *
 * Every play path calls this function, so it must not throw on bad catalog
 * data. A `surah_metadata` that is not an array, and a null entry, give the
 * unsuffixed path.
 */
export function suffixedAudioRange(
  metadata: (SurahMetadata | null | undefined)[] | null | undefined,
  surahId: number,
): {from: number; to: number} | undefined {
  const entry = Array.isArray(metadata)
    ? metadata.find(m => m?.surah === surahId)
    : undefined;
  if (!entry || entry.audio_path !== 'suffixed' || entry.is_full !== false) {
    return undefined;
  }
  const range = entry.range;
  if (
    !range ||
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 1 ||
    range.to < range.from
  ) {
    // A bad range cannot name a file. Use the legacy path.
    return undefined;
  }
  return range;
}

/**
 * The URL of the audio file of `surahId` in `rewayat`.
 *
 * `surahId` can be a number or a string ("2" or "002"). The legacy URL is
 * the same string that the old builders made.
 */
export function recitationAudioUrl(
  rewayat: Pick<Rewayat, 'server' | 'surah_metadata'>,
  surahId: number | string,
): string {
  const padded = String(surahId).padStart(3, '0');
  const range = suffixedAudioRange(rewayat.surah_metadata, Number(surahId));
  return range
    ? `${rewayat.server}/${padded}-${range.from}-${range.to}.mp3`
    : `${rewayat.server}/${padded}.mp3`;
}
