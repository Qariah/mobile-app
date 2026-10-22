// @ai-generated
// Qariah (Sprint 48): the "Newly Added" Listen row. It hides itself while the
// catalog has no dated recitation, and it computes again on each catalog
// refill: `populateReciters` refills `RECITERS` in place and calls
// `markRecitersUpdated`, while `isInitialized` changes only on the first fill.
import React from 'react';
import {FlatList} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import {NewlyAddedRecitationsRow} from '../NewlyAddedRecitationsRow';
import type {NewlyAddedRecitation} from '@/data/reciterCollections';
import {
  RECITERS,
  markRecitersUpdated,
  type Reciter,
  type Rewayat,
} from '@/data/reciterData';

// services/dataService (formatAyahRange) imports the player store, which
// loads expo-audio; the card needs none of it.
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({})},
}));
// The persisted stores report to Sentry; the real module keeps a timer open.
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/hooks/useGlassProps', () => ({
  USE_GLASS: false,
  useGlassColorScheme: () => 'light',
}));

jest.mock('@/components/ReciterImage', () => {
  const {View: MockView} = require('react-native');
  return {ReciterImage: () => <MockView />};
});

const mockPlayRecitation = jest.fn();
jest.mock('@/services/player/utils/playRecitation', () => ({
  playRecitation: (...args: unknown[]) => mockPlayRecitation(...args),
}));

const today = new Date().toISOString().slice(0, 10);

function reciter(
  id: string,
  name: string,
  surahs: {surah: number; range?: {from: number; to: number}}[],
  addedAt: string = today,
): Reciter {
  const rewayah: Rewayat = {
    id: `${id}-rw`,
    reciter_id: id,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahs.length,
    surah_list: surahs.map(s => s.surah),
    source_type: 'test',
    created_at: '2026-01-01',
    surah_metadata: surahs.map(s => ({
      surah: s.surah,
      is_full: !s.range,
      ...(s.range ? {range: s.range} : {}),
      added_at: addedAt,
    })),
  };
  return {id, name, date: null, image_url: null, rewayat: [rewayah]};
}

/** What `populateReciters` does: refill in place, then bump the version. */
function fillCatalog(reciters: Reciter[]) {
  act(() => {
    RECITERS.splice(0, RECITERS.length, ...reciters);
    markRecitersUpdated();
  });
}

describe('NewlyAddedRecitationsRow', () => {
  const saved = [...RECITERS];
  beforeEach(() => {
    RECITERS.splice(0, RECITERS.length);
    mockPlayRecitation.mockReset();
  });
  afterAll(() => {
    RECITERS.splice(0, RECITERS.length, ...saved);
  });

  it('renders nothing while no recitation has an added_at', () => {
    RECITERS.push({
      ...reciter('a', 'Aisha', [{surah: 1}]),
      rewayat: [
        {...reciter('a', 'Aisha', [{surah: 1}]).rewayat[0], surah_metadata: []},
      ],
    });
    const root = render(<NewlyAddedRecitationsRow />);
    expect(root.queryByTestId('newly-added-recitations-row')).toBeNull();
    expect(root.toJSON()).toBeNull();
  });

  it('computes again when the catalog is filled again', () => {
    const root = render(<NewlyAddedRecitationsRow />);
    expect(root.toJSON()).toBeNull();

    // The first fill (the bundled seed or the cache).
    fillCatalog([reciter('a', 'Aisha', [{surah: 1}])]);
    expect(root.getByText('Newly Added Recitations')).toBeTruthy();
    expect(root.getAllByTestId('recitation-card')).toHaveLength(1);
    expect(root.getByText('Al-Fatihah')).toBeTruthy();

    // A later fill (the background refresh or the version poll) with a new
    // recitation. `isInitialized` does not change here.
    fillCatalog([
      reciter('a', 'Aisha', [{surah: 1}]),
      reciter('b', 'Bushra', [{surah: 2, range: {from: 1, to: 5}}]),
    ]);
    expect(root.getAllByTestId('recitation-card')).toHaveLength(2);
    expect(root.getByText('Al-Baqarah')).toBeTruthy();
    expect(root.getByText('ayahs 1–5')).toBeTruthy();

    // A fill that removes every dated recitation hides the row again.
    fillCatalog([]);
    expect(root.toJSON()).toBeNull();
  });

  it('caps the cards at 3 for each reciter', () => {
    fillCatalog([
      reciter(
        'a',
        'Aisha',
        [1, 2, 3, 4, 5, 6].map(surah => ({surah})),
      ),
      reciter('b', 'Bushra', [{surah: 7}]),
    ]);
    const root = render(<NewlyAddedRecitationsRow />);
    // Same date: Aisha's surahs 1–3 (the cap), then Bushra's surah 7.
    expect(root.getAllByTestId('recitation-card')).toHaveLength(4);
    expect(root.getByText("Ali 'Imran")).toBeTruthy();
    expect(root.getByText("Al-A'raf")).toBeTruthy();
    expect(root.queryByText('An-Nisa')).toBeNull();
  });

  it('fills the capped places with older recitations of other reciters, up to 10 cards', () => {
    // One reciter has the 17 newest recitations; the cap keeps 3 of them,
    // and older recitations of three other reciters fill the row to 10.
    fillCatalog([
      reciter(
        'a',
        'Aisha',
        Array.from({length: 17}, (_, i) => ({surah: i + 1})),
      ),
      reciter(
        'b',
        'Bushra',
        [{surah: 18}, {surah: 19}, {surah: 20}],
        '2025-01-03',
      ),
      reciter(
        'c',
        'Fatima',
        [{surah: 21}, {surah: 22}, {surah: 23}],
        '2025-01-02',
      ),
      reciter(
        'd',
        'Huda',
        [{surah: 24}, {surah: 25}, {surah: 26}],
        '2025-01-01',
      ),
    ]);
    const root = render(<NewlyAddedRecitationsRow />);
    // The list renders its first 5 cards at once, so read its data.
    const data: NewlyAddedRecitation[] =
      root.UNSAFE_getByType(FlatList).props.data;
    expect(data.map(r => r.reciter.id)).toEqual([
      'a',
      'a',
      'a',
      'b',
      'b',
      'b',
      'c',
      'c',
      'c',
      'd',
    ]);
  });

  it('plays the recitation on a tap', () => {
    fillCatalog([
      reciter('b', 'Bushra', [{surah: 2, range: {from: 1, to: 5}}]),
    ]);
    const root = render(<NewlyAddedRecitationsRow />);
    fireEvent.press(root.getByTestId('recitation-card'));
    expect(mockPlayRecitation).toHaveBeenCalledTimes(1);
    const [playedReciter, playedRewayah, playedSurah] =
      mockPlayRecitation.mock.calls[0];
    expect(playedReciter.id).toBe('b');
    expect(playedRewayah.id).toBe('b-rw');
    expect(playedSurah).toBe(2);
  });
});
