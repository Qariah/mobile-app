// @ai-generated
// Qariah (UX critique 2026-11-11): the icon-only controls of the reciter
// profile had no label for TalkBack or VoiceOver: Back, Share and Search on
// Android (NavigationButtons), Share and Search on iOS 26 (the native header
// of ReciterProfile.tsx), and the "Loved only" and "Grid view" toggles of the
// sort row on both. The Android icons also had hit areas of 24 pt (Back) and
// 36 pt (Share, Search).
//
// Part 1 renders NavigationButtons and finds each control by its label.
// Part 2 reads the source of ReciterProfile.tsx, as stickyTitleInset.test.tsx
// does: a mount of the profile costs more mocks than the assertion is worth,
// and a wholesale upstream take of the file is the known way to lose Qariah
// lines (TECH_DEBT #114, #115).
import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import {Animated, StyleSheet} from 'react-native';
import {readFileSync} from 'fs';
import {join} from 'path';
import i18n from 'i18next';
import {moderateScale} from '@/utils/scale';
import {resources} from '@/i18n/resources';
import {
  BACK_HIT_SLOP,
  NavigationButtons,
  SEARCH_HIT_SLOP,
  SHARE_HIT_SLOP,
  mirrorInRTL,
} from '../components/NavigationButtons';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({useRouter: () => ({back: mockBack})}));

jest.mock('@expo/vector-icons', () => ({
  Feather: (_props: {name: string; size: number}) => null,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {text: '#111'}}}),
}));

jest.mock('@/utils/rtl', () => ({flipX: {}, isRTL: false}));

type Node = TestRenderer.ReactTestInstance;
type Slop = {top: number; bottom: number; left: number; right: number};

function renderButtons(onSearch: () => void, onShare: () => void): Node {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <NavigationButtons
        insets={{top: 24}}
        iconsOpacity={new Animated.Value(1)}
        iconsZIndex={new Animated.Value(20)}
        onSearchPress={onSearch}
        onSharePress={onShare}
      />,
    );
  });
  if (!renderer) throw new Error('NavigationButtons did not render');
  return renderer.root;
}

/** The host view that TalkBack reads with this label. */
function byLabel(root: Node, label: string): Node {
  const found = root.findAll(
    n =>
      typeof n.type === 'string' &&
      n.props.accessibilityLabel === label &&
      n.props.accessibilityRole === 'button',
  );
  expect(found).toHaveLength(1);
  return found[0];
}

function iconSize(node: Node): number {
  return node.findAll(n => typeof n.props.size === 'number')[0].props.size;
}

describe('NavigationButtons (Android)', () => {
  beforeEach(() => mockBack.mockClear());

  it('labels Back, Share and Search, and each one does its action', () => {
    const onSearch = jest.fn();
    const onShare = jest.fn();
    const root = renderButtons(onSearch, onShare);

    for (const [label, handler] of [
      ['Back', mockBack],
      ['Share', onShare],
      ['Search', onSearch],
    ] as const) {
      const host = byLabel(root, label);
      const pressable = root.findAll(
        n =>
          typeof n.type !== 'string' &&
          n.props.accessibilityLabel === label &&
          typeof n.props.onPress === 'function',
      )[0];
      expect(host).toBeDefined();
      act(() => pressable.props.onPress());
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('gives each icon a 44 pt hit area', () => {
    const root = renderButtons(jest.fn(), jest.fn());
    for (const [label, slop] of [
      ['Back', BACK_HIT_SLOP],
      ['Share', SHARE_HIT_SLOP],
      ['Search', SEARCH_HIT_SLOP],
    ] as const) {
      const host = byLabel(root, label);
      const size = iconSize(host);
      expect(host.props.hitSlop).toEqual(slop);
      expect(size + slop.left + slop.right).toBeGreaterThanOrEqual(44 - 1e-9);
      expect(size + slop.top + slop.bottom).toBeGreaterThanOrEqual(44 - 1e-9);
    }
  });

  it('keeps Share and Search apart: their facing sides share the gap', () => {
    const root = renderButtons(jest.fn(), jest.fn());
    const share = root.findAll(
      n =>
        typeof n.type !== 'string' &&
        n.props.accessibilityLabel === 'Share' &&
        n.props.style != null,
    )[0];
    const gap = (StyleSheet.flatten(share.props.style) ?? {}).marginRight;
    expect(gap).toBe(moderateScale(16));
    expect(SHARE_HIT_SLOP.right + SEARCH_HIT_SLOP.left).toBeLessThanOrEqual(
      gap as number,
    );
  });

  it('grows at most 6 pt below the icons, above the pinned sort row', () => {
    for (const slop of [BACK_HIT_SLOP, SHARE_HIT_SLOP, SEARCH_HIT_SLOP]) {
      expect(slop.bottom).toBeLessThanOrEqual(6);
    }
  });

  it('swaps left and right in RTL, where the row mirrors', () => {
    const slop: Slop = {top: 1, bottom: 2, left: 3, right: 4};
    expect(mirrorInRTL(slop, false)).toEqual(slop);
    expect(mirrorInRTL(slop, true)).toEqual({
      top: 1,
      bottom: 2,
      left: 4,
      right: 3,
    });
  });
});

describe('the label strings', () => {
  it('exist in English and in Arabic', () => {
    expect(i18n.t('qariah:a11y.reciterProfile.lovedOnly')).toBe('Loved only');
    expect(i18n.t('qariah:a11y.reciterProfile.gridView')).toBe('Grid view');
    const ar = (resources as Record<string, Record<string, unknown>>).ar
      .qariah as {a11y: {reciterProfile: Record<string, string>}};
    expect(ar.a11y.reciterProfile.lovedOnly).toBeTruthy();
    expect(ar.a11y.reciterProfile.gridView).toBeTruthy();
  });
});

// DO NOT DROP: guards the Qariah labels in ReciterProfile.tsx.
describe('ReciterProfile.tsx labels', () => {
  const source = readFileSync(
    join(__dirname, '..', 'ReciterProfile.tsx'),
    'utf8',
  );

  /** The props of the Pressable whose press handler is `handler`. */
  function pressableProps(handler: string): string {
    const at = source.indexOf(handler);
    expect(at).toBeGreaterThan(-1);
    const start = source.lastIndexOf('<Pressable', at);
    const end = source.indexOf('>\n', at);
    return source.slice(start, end);
  }

  it('labels Share and Search in the iOS 26 header', () => {
    const header = source.slice(
      source.indexOf('headerRight: showSearch'),
      source.indexOf('}, [navigation, theme, showSearch, t]);'),
    );
    expect(header).toContain("accessibilityLabel={t('common:actions.share')}");
    expect(header).toContain("accessibilityLabel={t('common:actions.search')}");
  });

  it('labels the "Loved only" toggle and says when it is on', () => {
    const props = pressableProps('onPress={toggleShowLovedOnly}');
    expect(props).toContain('accessibilityRole="button"');
    expect(props).toMatch(
      /accessibilityLabel=\{t\(\s*'qariah:a11y\.reciterProfile\.lovedOnly',?\s*\)\}/,
    );
    expect(props).toContain('accessibilityState={{selected: showLovedOnly}}');
  });

  it('labels the "Grid view" toggle and says when the grid shows', () => {
    const props = pressableProps('onPress={toggleViewMode}');
    expect(props).toContain('accessibilityRole="button"');
    expect(props).toMatch(
      /accessibilityLabel=\{t\(\s*'qariah:a11y\.reciterProfile\.gridView',?\s*\)\}/,
    );
    expect(props).toContain(
      "accessibilityState={{selected: viewMode === 'card'}}",
    );
  });
});
