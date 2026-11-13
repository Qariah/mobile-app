// @ai-generated
/**
 * The 44 pt hit areas of the Mushaf bar and header (UX critique 2026-11-11).
 * `moderateScale` reads the window once at import, so this suite computes
 * the sizes with the same formula at four phone widths: 320 pt (the
 * smallest), 360 pt (Galaxy A10s), 393 pt (Pixel 3, iPhone) and 411 pt.
 * The render suite (MushafPlayerBar.hitArea.test.tsx) checks that the bar
 * uses these slops and that the styles have these sizes.
 */
import type {Insets} from 'react-native';
import {
  MIN_HIT_AREA,
  evenHitSlop,
  headerIconSize,
  playerBarHitSlops,
  playerBarSizes,
} from '../mushafHitSlop';

// utils/scale.ts on a phone: size + (shortSide / 350 * size - size) * 0.5.
const scaleFor = (width: number) => (size: number) =>
  size + ((width / 350) * size - size) * 0.5;

const WIDTHS = [320, 360, 393, 411];

const side = (slop: Insets, key: keyof Insets) => slop[key] ?? 0;
const hitWidth = (width: number, slop: Insets) =>
  width + side(slop, 'left') + side(slop, 'right');
const hitHeight = (height: number, slop: Insets) =>
  height + side(slop, 'top') + side(slop, 'bottom');

describe.each(WIDTHS)('at a %i pt window', width => {
  const ms = scaleFor(width);
  const size = playerBarSizes(ms);
  const slop = playerBarHitSlops(ms);
  const atLeast44 = MIN_HIT_AREA - 1e-9;

  it('gives every button of the bar a 44 pt hit area', () => {
    const boxes: [number, number, Insets][] = [
      [size.edge, size.edge, slop.idleEdge],
      [size.play, size.play, slop.idlePlay],
      [size.edge, size.edge, slop.activeEdge],
      [size.playPause, size.playPause, slop.playPause],
      [size.chevronWidth, size.chevronHeight, slop.chevron],
    ];
    for (const [w, h, s] of boxes) {
      expect(hitWidth(w, s)).toBeGreaterThanOrEqual(atLeast44);
      expect(hitHeight(h, s)).toBeGreaterThanOrEqual(atLeast44);
    }
  });

  it('keeps the 8 pt centre gap free of overlap', () => {
    // [prev chevron] gap [pause] gap [next chevron], laid out left to right.
    expect(
      side(slop.chevron, 'right') + side(slop.playPause, 'left'),
    ).toBeLessThanOrEqual(size.centreGap);
    expect(
      side(slop.playPause, 'right') + side(slop.chevron, 'left'),
    ).toBeLessThanOrEqual(size.centreGap);
  });

  it('keeps Stop and Playback options clear of the centre group', () => {
    // The bar is the window wide, with 8 pt of padding on each side.
    const row = width - 2 * ms(8);
    const centre = 2 * size.chevronWidth + size.playPause + 2 * size.centreGap;
    const free = (row - 2 * size.edge - centre) / 2;
    expect(
      side(slop.activeEdge, 'right') + side(slop.chevron, 'left'),
    ).toBeLessThan(free);
  });

  it('never grows the active row above the bar, where the page is', () => {
    for (const s of [slop.activeEdge, slop.playPause, slop.chevron]) {
      expect(side(s, 'top')).toBe(0);
    }
  });

  it('keeps the idle buttons in the 52 pt row', () => {
    for (const [h, s] of [
      [size.edge, slop.idleEdge],
      [size.play, slop.idlePlay],
    ] as const) {
      expect(side(s, 'top')).toBeLessThanOrEqual((size.idleRowHeight - h) / 2);
      expect(side(s, 'bottom')).toBeLessThanOrEqual(
        (size.idleRowHeight - h) / 2,
      );
    }
  });

  it('keeps Mushaf settings in its 44 pt header slot', () => {
    const icon = headerIconSize(ms);
    const s = evenHitSlop(icon);
    expect(hitWidth(icon, s)).toBeGreaterThanOrEqual(atLeast44);
    expect(hitHeight(icon, s)).toBeGreaterThanOrEqual(atLeast44);
    // The icon sits at the end of the slot; its other side faces the title
    // button, which fills the space between the two slots.
    expect(side(s, 'left')).toBeLessThanOrEqual(ms(44) - icon);
  });
});

it('reproduces the sizes that the critique measured on the A10s', () => {
  const size = playerBarSizes(scaleFor(360));
  expect(size.edge).toBeCloseTo(36.5, 1);
  expect(size.playPause).toBeCloseTo(38.5, 1);
  expect(size.chevronHeight).toBeCloseTo(38.5, 1);
  expect(headerIconSize(scaleFor(360))).toBeCloseTo(34.5, 1);
});
