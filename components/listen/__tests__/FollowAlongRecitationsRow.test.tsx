// @ai-generated
// Qariah (#847, option C): the "Follow Along" Listen row of recitations.
import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {FollowAlongRecitationsRow} from '../FollowAlongRecitationsRow';
import type {FollowAlongRecitation} from '../followAlongRow';
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
// The SQLite cache pulls in expo-sqlite (native).
jest.mock('@/services/timestamps/TimestampDatabaseService', () => ({
  timestampDatabaseService: {writeTimestamps: jest.fn()},
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

function card(id: string, name: string, surah: number): FollowAlongRecitation {
  const rewayah: Rewayat = {
    id: `${id}-rw`,
    reciter_id: id,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: 1,
    surah_list: [surah],
    source_type: 'test',
    created_at: '2026-01-01',
  };
  const reciter: Reciter = {
    id,
    name,
    date: null,
    image_url: null,
    rewayat: [rewayah],
  };
  return {reciter, rewayah, surah};
}

const CARDS = [
  card('w', "Wardatun Nisa' Hasan", 36),
  card('a', 'Anwar Mansour', 50),
  card('z', 'Zaynab Talha', 67),
];

describe('FollowAlongRecitationsRow', () => {
  beforeEach(() => mockPlayRecitation.mockReset());

  it('renders nothing with no card', () => {
    const root = render(<FollowAlongRecitationsRow recitations={[]} />);
    expect(root.toJSON()).toBeNull();
  });

  it('shows the existing "Follow Along" title and one card for each recitation', () => {
    const root = render(<FollowAlongRecitationsRow recitations={CARDS} />);
    expect(root.getByTestId('follow-along-recitations-row')).toBeTruthy();
    expect(root.getByText('Follow Along')).toBeTruthy();
    const cards = root.getAllByTestId('recitation-card');
    expect(cards.map(c => c.props.accessibilityLabel)).toEqual([
      "Play Ya-Sin by Wardatun Nisa' Hasan",
      'Play Qaf by Anwar Mansour',
      'Play Al-Mulk by Zaynab Talha',
    ]);
  });

  it('plays the recitation of a card on a tap', () => {
    const root = render(<FollowAlongRecitationsRow recitations={CARDS} />);
    fireEvent.press(root.getAllByTestId('recitation-card')[1]);
    expect(mockPlayRecitation).toHaveBeenCalledTimes(1);
    expect(mockPlayRecitation).toHaveBeenCalledWith(
      CARDS[1].reciter,
      CARDS[1].rewayah,
      50,
    );
  });

  it('gives a card to the press handler of a test', () => {
    const onPress = jest.fn();
    const root = render(
      <FollowAlongRecitationsRow
        recitations={CARDS}
        onRecitationPress={onPress}
      />,
    );
    fireEvent.press(root.getAllByTestId('recitation-card')[2]);
    expect(onPress).toHaveBeenCalledWith(CARDS[2]);
    expect(mockPlayRecitation).not.toHaveBeenCalled();
  });
});
