// @ai-generated
// Qariah (PLY-13): a user playlist marks its tracks, so the end of a playlist
// stops, also with one item. queueNextSurah() reads the mark. The mark rides on
// the track, so a persisted queue keeps it after a restart.
import type {Track} from '@/types/audio';

/** A queued track with the Qariah mark; upstream's `Track` does not declare it. */
type MarkedTrack = Track & {qariahFromPlaylist?: true};

/** Returns copies of the tracks with the playlist mark. */
export function markPlaylistTracks<T extends Track>(tracks: T[]): T[] {
  return tracks.map(t => ({...t, qariahFromPlaylist: true as const}));
}

/** True when a user playlist queued the track. */
export function isFromPlaylist(track: Track): boolean {
  return (track as MarkedTrack).qariahFromPlaylist === true;
}
