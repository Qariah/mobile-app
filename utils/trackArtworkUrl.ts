// @ai-generated
// TECH_DEBT #262: the photo URL that a mini player gives to `ReciterImage`.
//
// The full player (`PlayerContent/TrackInfo.tsx`) passes `track.artwork`.
// Every track builder sets that field with `getReciterArtwork(reciter)`
// (utils/artworkUtils.ts), and the session restore sets it again from the
// catalog, so it holds the catalog photo URL after the asset-host rewrite of
// `services/dataService.ts`. The mini players passed only the reciter name.
// `ReciterImage` then found no bundled photo for a catalog reciter and showed
// the person icon.
//
// `getReciterArtwork` can also return a bundled asset reference or a 1x1
// transparent PNG (a reciter with no photo). This helper gives only a remote
// URL. For the other values, the mini player keeps its own fallback: the
// bundled photo by name, then the person icon.
import type {Track} from '@/types/audio';

const REMOTE_URL = /^https?:\/\//i;

/** The remote photo URL of the track, or undefined. */
export function trackArtworkUrl(
  track: Pick<Track, 'artwork'> | null | undefined,
): string | undefined {
  const artwork = track?.artwork;
  return artwork && REMOTE_URL.test(artwork) ? artwork : undefined;
}
