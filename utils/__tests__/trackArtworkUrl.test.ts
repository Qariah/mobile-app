// @ai-generated
// TECH_DEBT #262: the mini players give `ReciterImage` only a remote photo URL.
import {trackArtworkUrl} from '../trackArtworkUrl';

describe('trackArtworkUrl (TECH_DEBT #262)', () => {
  it('gives the remote photo URL of the track', () => {
    const url = 'https://example.test/reciters/zaynab-talha/photo.jpg?v=1';
    expect(trackArtworkUrl({artwork: url})).toBe(url);
    expect(trackArtworkUrl({artwork: 'http://localhost:8081/a.png'})).toBe(
      'http://localhost:8081/a.png',
    );
  });

  it('gives undefined for a track with no remote photo', () => {
    expect(trackArtworkUrl(undefined)).toBeUndefined();
    expect(trackArtworkUrl(null)).toBeUndefined();
    expect(trackArtworkUrl({})).toBeUndefined();
    expect(trackArtworkUrl({artwork: ''})).toBeUndefined();
    // The 1x1 transparent PNG of getReciterArtwork (a reciter with no photo):
    // the mini player shows the person icon, not an empty square.
    expect(
      trackArtworkUrl({artwork: 'data:image/png;base64,iVBORw0KGgo='}),
    ).toBeUndefined();
    // A bundled asset reference: the mini player finds it by the name.
    expect(
      trackArtworkUrl({artwork: 'file:///app/assets/reciter.jpeg'}),
    ).toBeUndefined();
    expect(
      trackArtworkUrl({artwork: 'assets_reciterimages_reciter'}),
    ).toBeUndefined();
  });
});
