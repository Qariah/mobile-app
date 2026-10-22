// @ai-generated
// Qariah (Sprint 48): the recitation card of the "Newly Added" Listen row.
import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {RecitationCard} from '../RecitationCard';
import type {NewlyAddedRecitation} from '@/data/reciterCollections';
import type {Reciter, Rewayat} from '@/data/reciterData';

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
  return {
    ReciterImage: ({imageUrl}: {imageUrl?: string}) => (
      <MockView testID="reciter-image" accessibilityHint={imageUrl} />
    ),
  };
});

const rewayah: Rewayat = {
  id: 'rw1',
  reciter_id: 'r1',
  name: "Hafs A'n Assem",
  style: 'murattal',
  server: 'https://example.invalid/audio',
  surah_total: 2,
  surah_list: [2, 112],
  source_type: 'test',
  created_at: '2026-01-01',
};

const reciter: Reciter = {
  id: 'r1',
  name: 'Aisha Example',
  date: null,
  image_url: 'https://example.invalid/aisha.jpg',
  rewayat: [rewayah],
};

const partial: NewlyAddedRecitation = {
  reciter,
  rewayah,
  surah: 2,
  range: {from: 5, to: 20},
  addedAt: '2026-10-19',
};

const full: NewlyAddedRecitation = {
  reciter,
  rewayah,
  surah: 112,
  addedAt: '2026-10-18',
};

describe('RecitationCard', () => {
  it('shows the surah name, the reciter name, the photo and the range of a partial recording', () => {
    const {getByText, getByTestId} = render(
      <RecitationCard recitation={partial} onPress={jest.fn()} />,
    );
    expect(getByText('Al-Baqarah')).toBeTruthy();
    expect(getByText('Aisha Example')).toBeTruthy();
    expect(getByText('ayahs 5–20')).toBeTruthy();
    expect(getByTestId('reciter-image').props.accessibilityHint).toBe(
      'https://example.invalid/aisha.jpg',
    );
    expect(getByTestId('recitation-card').props.accessibilityLabel).toBe(
      'Play Al-Baqarah, ayahs 5–20, by Aisha Example',
    );
  });

  it('shows no range for a full surah', () => {
    const {getByText, queryByText, getByTestId} = render(
      <RecitationCard recitation={full} onPress={jest.fn()} />,
    );
    expect(getByText('Al-Ikhlas')).toBeTruthy();
    expect(getByText('Aisha Example')).toBeTruthy();
    expect(queryByText(/ayah/)).toBeNull();
    expect(getByTestId('recitation-card').props.accessibilityLabel).toBe(
      'Play Al-Ikhlas by Aisha Example',
    );
  });

  it('shows a single ayah as "ayah N"', () => {
    const {getByText} = render(
      <RecitationCard
        recitation={{...partial, range: {from: 255, to: 255}}}
        onPress={jest.fn()}
      />,
    );
    expect(getByText('ayah 255')).toBeTruthy();
  });

  it('calls the press handler with its recitation', () => {
    const onPress = jest.fn();
    const {getByTestId} = render(
      <RecitationCard recitation={partial} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('recitation-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(partial);
  });
});
