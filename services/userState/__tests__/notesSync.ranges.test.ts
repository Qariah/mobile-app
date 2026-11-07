// The QF range of a note (services/userState/notesSync.ts). Since upstream's
// rewayah verse units (Bayaan #329), a note on part of a split Hafs verse is
// anchored at a word ("1:7:5"). QF ranges name whole verses.

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {patchNoteQfIds: jest.fn()},
}));
jest.mock('../notes', () => ({
  verseKeyToRange: (key: string) => `${key}-${key}`,
  verseKeysToRange: (keys: string[]) =>
    keys.length === 1
      ? `${keys[0]}-${keys[0]}`
      : `${keys[0]}-${keys[keys.length - 1]}`,
}));
jest.mock('@/services/auth/qfOAuth', () => ({isSignedIn: jest.fn()}));

import {buildRanges, hafsVerseOfAnchor} from '../notesSync';

describe('hafsVerseOfAnchor', () => {
  it('keeps a verse key and drops a word position', () => {
    expect(hafsVerseOfAnchor('2:255')).toBe('2:255');
    expect(hafsVerseOfAnchor('1:7:5')).toBe('1:7');
  });
});

describe('buildRanges', () => {
  it('builds a one-verse range from a Hafs verse key, as before', () => {
    expect(buildRanges({verseKey: '2:255'})).toEqual(['2:255-2:255']);
  });

  it('names the Hafs verse that holds a word anchor', () => {
    expect(buildRanges({verseKey: '1:7:5'})).toEqual(['1:7-1:7']);
  });

  it('spans the Hafs verses of every anchor of a range', () => {
    expect(buildRanges({verseKey: '1:6', verseKeys: ['1:6', '1:7:1']})).toEqual(
      ['1:6-1:7'],
    );
  });
});
