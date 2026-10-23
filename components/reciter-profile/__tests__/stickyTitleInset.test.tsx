// @ai-generated
// Qariah (TECH_DEBT #320): a long reciter name must not run under the share
// icon of the reciter profile. The sticky title (Android, and iOS before 26)
// sits in the same row as the back, share and search icons.
//
// Part 1 renders NavigationButtons and checks that NAVIGATION_TITLE_INSET
// covers the end icons, so a change of an icon size or a margin fails here.
// Part 2 reads the source of ReciterProfile.tsx, as main.rotationStage.test.ts
// does for main.tsx: a mount of the profile costs more mocks than the
// assertion is worth, and a wholesale upstream take of ReciterProfile.tsx is
// the known way to lose Qariah lines (TECH_DEBT #114, #115).
import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import {Animated, StyleSheet} from 'react-native';
import {readFileSync} from 'fs';
import {join} from 'path';
import {moderateScale} from 'react-native-size-matters';
import {
  NAVIGATION_TITLE_INSET,
  NavigationButtons,
} from '../components/NavigationButtons';

jest.mock('expo-router', () => ({useRouter: () => ({back: jest.fn()})}));

jest.mock('@expo/vector-icons', () => ({
  Feather: (_props: {name: string; size: number}) => null,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {text: '#111'}}}),
}));

jest.mock('@/utils/rtl', () => ({flipX: {}}));

type Node = TestRenderer.ReactTestInstance;

function flatStyle(node: Node): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

function renderButtons(
  onSharePress: () => void,
): TestRenderer.ReactTestRenderer {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <NavigationButtons
        insets={{top: 24}}
        iconsOpacity={new Animated.Value(1)}
        iconsZIndex={new Animated.Value(20)}
        onSearchPress={jest.fn()}
        onSharePress={onSharePress}
      />,
    );
  });
  if (!renderer) {
    throw new Error('NavigationButtons did not render');
  }
  return renderer;
}

// The first composite node that matches. An Animated.View and the View in it
// carry the same props, so `find` (exactly one) does not apply.
function first(root: Node, match: (n: Node) => boolean): Node {
  const found = root.findAll(n => typeof n.type !== 'string' && match(n));
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

function icon(root: Node, name: string): Node {
  return first(root, n => n.props.name === name);
}

describe('NAVIGATION_TITLE_INSET (TECH_DEBT #320)', () => {
  it('covers the end icons (share and search) and a gap of 8', () => {
    const onShare = jest.fn();
    const {root} = renderButtons(onShare);

    const group = first(
      root,
      n =>
        typeof flatStyle(n).right === 'number' &&
        flatStyle(n).flexDirection === 'row',
    );
    const share = first(root, n => n.props.onPress === onShare);
    const endIcons =
      (flatStyle(group).right as number) +
      (icon(root, 'share').props.size as number) +
      (flatStyle(share).marginRight as number) +
      (icon(root, 'search').props.size as number);

    expect(NAVIGATION_TITLE_INSET - endIcons).toBeGreaterThanOrEqual(
      moderateScale(8) - 1e-6,
    );
  });

  it('also covers the back icon on the other side', () => {
    const {root} = renderButtons(jest.fn());
    const back = first(root, n => typeof flatStyle(n).left === 'number');
    const backIcons =
      (flatStyle(back).left as number) +
      (icon(root, 'arrow-left').props.size as number);

    expect(NAVIGATION_TITLE_INSET).toBeGreaterThan(backIcons);
  });
});

// DO NOT DROP — guards the TECH_DEBT #320 lines in ReciterProfile.tsx.
describe('ReciterProfile.tsx sticky title (TECH_DEBT #320)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'ReciterProfile.tsx'),
    'utf8',
  );
  const start = source.indexOf('{/* Sticky title bar');
  const end = source.indexOf('</RNAnimated.View>', start);
  const block = source.slice(start, end);

  it('finds the sticky title block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain('getReciterDisplayName(reciter)');
  });

  it('pads each side of the title by the width of the end icons', () => {
    expect(block).toMatch(/paddingHorizontal: NAVIGATION_TITLE_INSET,/);
  });

  it('shows the title on one line, with "…" at the end of a long name', () => {
    const text = block.slice(block.indexOf('<Text'));
    expect(text).toMatch(/numberOfLines=\{1\}/);
    expect(text).toMatch(/ellipsizeMode="tail"/);
  });
});
