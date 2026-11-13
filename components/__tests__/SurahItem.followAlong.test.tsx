// @ai-generated
// Qariah (#847, option C): the "Follow Along" chip on the chip line of a
// surah row, after the place chip.
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SurahItem} from '../SurahItem';
import type {Surah} from '@/data/surahData';

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#000000',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#eeeeee',
        border: '#dddddd',
      },
      fonts: {regular: 'r', medium: 'm'},
    },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));
jest.mock('@/i18n/format', () => ({
  getSurahDisplayName: (s: {name: string}) => s.name,
  getSurahMeaning: () => 'Ya Sin',
  localizeDigits: (n: number) => String(n),
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: (select: (state: unknown) => unknown) =>
    select({
      playback: {state: 'paused'},
      queue: {currentIndex: -1, tracks: []},
    }),
}));
jest.mock('@/services/player/store/downloadSelectors', () => ({
  useDownloadProgress: () => 0,
  useIsDownloaded: () => false,
  useIsDownloadedWithRewayat: () => false,
  useIsDownloading: () => false,
}));
jest.mock('@/components/Icons', () => {
  const {Text: MockText} = jest.requireActual('react-native');
  return {
    HeartIcon: () => null,
    MakkahIcon: () => <MockText>place-chip</MockText>,
    MadinahIcon: () => <MockText>place-chip</MockText>,
  };
});
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  Ionicons: () => null,
}));
jest.mock('expo-haptics', () => ({impactAsync: jest.fn()}));
jest.mock('../NowPlayingIndicator', () => ({NowPlayingIndicator: () => null}));
jest.mock('@/components/GradientText', () => ({GradientText: () => null}));
jest.mock('@/components/CircularProgress', () => ({
  CircularProgress: () => null,
}));

const yaSin = {
  id: 36,
  name: 'Ya-Sin',
  verses_count: 83,
  revelation_place: 'makkah',
} as unknown as Surah;

function renderRow(element: Parameters<typeof TestRenderer.create>[0]) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const text: unknown = Text;
  const texts = renderer.root
    .findAll(n => n.type === text)
    .map(n => n.props.children)
    .flat();
  const label = renderer.root.findAll(
    n => n.props.accessibilityRole === 'button' && !!n.props.onPress,
  )[0]?.props.accessibilityLabel as string;
  return {texts, label};
}

describe('SurahItem "Follow Along" chip (#847)', () => {
  it('shows the chip after the place chip, and the row label says it last', () => {
    const {texts, label} = renderRow(
      <SurahItem item={yaSin} onPress={jest.fn()} showFollowAlong />,
    );
    const place = texts.indexOf('surahItem.makkah');
    const chip = texts.indexOf('followAlongBadge');
    expect(place).toBeGreaterThanOrEqual(0);
    expect(chip).toBeGreaterThan(place);
    expect(label.split('surahItem.a11ySeparator')).toEqual([
      'surahItem.a11yName',
      'Ya Sin',
      'surahItem.verses',
      'home.followAlong',
    ]);
  });

  it('shows no chip by default (every upstream caller)', () => {
    const {texts, label} = renderRow(
      <SurahItem item={yaSin} onPress={jest.fn()} />,
    );
    expect(texts).toContain('surahItem.makkah');
    expect(texts).not.toContain('followAlongBadge');
    expect(label).not.toContain('home.followAlong');
  });

  it('shows no chip and says nothing where the row has no place chip', () => {
    for (const props of [{tableColumns: true}, {rewayatName: 'Hafs'}]) {
      const {texts, label} = renderRow(
        <SurahItem
          item={yaSin}
          onPress={jest.fn()}
          showFollowAlong
          {...props}
        />,
      );
      expect(texts).not.toContain('followAlongBadge');
      expect(label).not.toContain('home.followAlong');
    }
  });
});
