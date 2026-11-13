// @ai-generated
/**
 * The Mushaf bar of Android and iOS 18 (MushafPlayerBar.tsx) gives each
 * button the hit slop of mushafHitSlop.ts, and the verse line under the
 * active row takes no touch (UX critique 2026-11-11). mushafHitSlop.test.ts
 * checks the sizes, the 44 pt sums and the gaps; this suite checks that the
 * rendered bar uses them, that its styles have the sizes that the math
 * assumes, and that each button has a label. The Mushaf settings icon of the
 * header (main.tsx) is checked in the source, as main.rotationStage.test.ts
 * does: a mount of the reader costs more mocks than the assertion is worth.
 */
import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {readFileSync} from 'fs';
import {join} from 'path';

jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#555555'}},
  }),
}));
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  Ionicons: () => null,
}));
jest.mock('@/components/Icons', () => ({
  PlayIcon: () => null,
  PauseIcon: () => null,
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));

// mushafPlayerStore's playback dependencies (not exercised here)
jest.mock('expo-audio', () => ({createAudioPlayer: jest.fn()}));
jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {mushafWillPlay: jest.fn(), sourceDidStop: jest.fn()},
}));
jest.mock('@/data/reciterData', () => ({RECITERS: []}));
jest.mock('@/services/timestamps/TimestampService', () => ({
  timestampService: {getTimestampsForSurah: async () => null},
}));
jest.mock('@/services/timestamps/TimestampFetchService', () => ({
  timestampFetchService: {hasSurah: () => true, hasSource: () => true},
}));
jest.mock('@/services/mushaf/MushafVerseMapService', () => ({
  mushafVerseMapService: {getOrderedVerseKeysForPage: () => []},
}));

import {MushafPlayerBar} from '@/components/mushaf/MushafPlayerBar';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import {moderateScale} from '@/utils/scale';
import {playerBarHitSlops, playerBarSizes} from '../mushafHitSlop';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

type Node = TestRenderer.ReactTestInstance;

const slop = playerBarHitSlops(moderateScale);
const size = playerBarSizes(moderateScale);

let renderer: TestRenderer.ReactTestRenderer | null = null;

function renderBar(state: object) {
  act(() => {
    useMushafPlayerStore.setState({
      playbackState: 'idle',
      currentSurah: 0,
      currentVerseKey: null,
      currentVerseKeys: [],
      currentVerseLabel: null,
      numberingMode: null,
      ignoredStartVerseKey: null,
      timestampError: null,
      ...state,
    });
  });
  act(() => {
    renderer = TestRenderer.create(<MushafPlayerBar currentPage={440} />);
  });
  if (!renderer) throw new Error('MushafPlayerBar did not render');
  return renderer.root;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

/** The host view of the button that has this label. */
function button(root: Node, label: string): Node {
  const found = root.findAll(
    n =>
      typeof n.type === 'string' &&
      n.props.accessibilityLabel === label &&
      n.props.accessibilityRole === 'button',
  );
  expect(found).toHaveLength(1);
  return found[0];
}

const style = (n: Node) =>
  (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, number>;

describe('idle bar', () => {
  it('gives Search, Play and Playback options their hit slop', () => {
    const root = renderBar({});
    expect(button(root, 'Search').props.hitSlop).toEqual(slop.idleEdge);
    expect(button(root, 'Play').props.hitSlop).toEqual(slop.idlePlay);
    expect(button(root, 'Playback options').props.hitSlop).toEqual(
      slop.idleEdge,
    );
  });

  it('has the sizes that the hit slops assume', () => {
    const root = renderBar({});
    expect(style(button(root, 'Search')).width).toBe(size.edge);
    expect(style(button(root, 'Search')).height).toBe(size.edge);
    expect(style(button(root, 'Play')).width).toBe(size.play);
    expect(style(button(root, 'Play')).height).toBe(size.play);
  });
});

describe('error bar', () => {
  it('gives Change qariah a 44 pt hit height', () => {
    const root = renderBar({timestampError: 'No timings for this surah'});
    const b = button(root, 'Change qariah');
    const pad = style(b).paddingVertical;
    const {top, bottom} = b.props.hitSlop;
    // 12 pt text has a line height of at least 16 pt.
    expect(16 + 2 * pad + top + bottom).toBeGreaterThanOrEqual(44);
  });
});

describe('active bar', () => {
  const playing = {
    playbackState: 'playing',
    currentSurah: 36,
    currentVerseKey: '36:10',
    currentVerseKeys: ['36:10'],
    currentVerseLabel: '36:10',
    numberingMode: 'hafs',
  };

  it('gives each button its hit slop', () => {
    const root = renderBar(playing);
    expect(button(root, 'Stop').props.hitSlop).toEqual(slop.activeEdge);
    expect(button(root, 'Previous ayah').props.hitSlop).toEqual(slop.chevron);
    expect(button(root, 'Pause').props.hitSlop).toEqual(slop.playPause);
    expect(button(root, 'Next ayah').props.hitSlop).toEqual(slop.chevron);
    expect(button(root, 'Playback options').props.hitSlop).toEqual(
      slop.activeEdge,
    );
  });

  it('has the sizes that the hit slops assume', () => {
    const root = renderBar(playing);
    expect(style(button(root, 'Stop')).width).toBe(size.edge);
    expect(style(button(root, 'Pause')).width).toBe(size.playPause);
    expect(style(button(root, 'Pause')).height).toBe(size.playPause);
    const chevron = style(button(root, 'Previous ayah'));
    const chevronIcon = button(root, 'Previous ayah').findAll(
      n => n.props.name === 'chevrons-left',
    )[0];
    expect(chevronIcon.props.size + 2 * chevron.paddingHorizontal).toBeCloseTo(
      size.chevronWidth,
      6,
    );
    expect(chevronIcon.props.size + 2 * chevron.paddingVertical).toBeCloseTo(
      size.chevronHeight,
      6,
    );
  });

  it('draws the verse line in a view that takes no touch', () => {
    const root = renderBar(playing);
    const line = root.findAll(
      n =>
        typeof n.type === 'string' &&
        n.props.testID === 'mushaf-bar-verse-line',
    );
    expect(line).toHaveLength(1);
    expect(line[0].props.pointerEvents).toBe('none');
    const text = line[0].findAll(n => n.type === ('Text' as never));
    expect(text.map(n => n.props.children)).toContain('Ya-Sin 36:10');
  });
});

// DO NOT DROP: the Qariah hit slop of the Mushaf settings icon in main.tsx.
describe('main.tsx header: Mushaf settings', () => {
  const source = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

  it('gives the settings button the 44 pt hit slop', () => {
    const start = source.indexOf('style={styles.headerIcon}');
    const end = source.indexOf('testID="mushaf-settings-button"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toContain(
      'hitSlop={HEADER_ICON_HIT_SLOP}',
    );
    expect(source).toMatch(
      /const HEADER_ICON_HIT_SLOP = evenHitSlop\(headerIconSize\(moderateScale\)\);/,
    );
  });

  it('keeps the icon size that headerIconSize assumes', () => {
    const styles = source.slice(source.indexOf('headerIcon: {'));
    expect(styles).toMatch(/^headerIcon: \{\s*padding: moderateScale\(6\),/);
    const icon = source.slice(
      source.indexOf('style={styles.headerIcon}'),
      source.indexOf(
        '</Pressable>',
        source.indexOf('style={styles.headerIcon}'),
      ),
    );
    expect(icon).toMatch(/size=\{moderateScale\(22\)\}/);
  });
});
