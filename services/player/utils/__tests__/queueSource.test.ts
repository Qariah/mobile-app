// @ai Qariah (PLY-13): the playlist mark on queued tracks.
import type {Track} from '@/types/audio';
import {isFromPlaylist, markPlaylistTracks} from '../queueSource';

const plain: Track = {
  id: 'r1-1',
  url: 'https://cdn.example.com/r1/hafs/1.mp3',
  title: 'Surah 1',
  artist: 'Reciter One',
  reciterId: 'r1',
  reciterName: 'Reciter One',
  surahId: '1',
  rewayatId: 'hafs',
};

describe('queueSource (PLY-13)', () => {
  it('marks copies of the tracks and keeps every other field', () => {
    const [marked] = markPlaylistTracks([plain]);

    expect(isFromPlaylist(marked)).toBe(true);
    expect(marked).toEqual({...plain, qariahFromPlaylist: true});
    expect(isFromPlaylist(plain)).toBe(false);
  });

  it('a mark survives a JSON round trip (the persisted queue)', () => {
    const [marked] = markPlaylistTracks([plain]);

    expect(isFromPlaylist(JSON.parse(JSON.stringify(marked)))).toBe(true);
  });
});
