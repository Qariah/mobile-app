// @ai
// Unit tests for the phone-landscape display-cutout fix (#349).
//
// On a notched / Dynamic Island iPhone held in landscape the sensor housing
// becomes a *side* edge. `getMushafLayout`'s phone-landscape branch drew the
// page edge-to-edge (`pageWidth = width`), so the outermost glyphs of each line
// were physically covered by the housing. The fix insets the page by the
// left/right safe area while leaving `screenWidth` at the full window width so
// the horizontal pager keeps snapping.
//
// Two facts drive every number below, and both are easy to get wrong:
//
//   1. UIKit reports landscape horizontal insets SYMMETRICALLY (59/59 on a
//      Dynamic Island phone, 44/44 on a notch phone) whichever side the housing
//      is physically on, so that content does not shift when the device is
//      flipped 180°. `react-native-safe-area-context` passes them through
//      verbatim. There is no iOS configuration that reports `59/0`, so the
//      symmetric cases below are the real ones and the asymmetric case is
//      generality only.
//   2. The insets are honoured on iOS ONLY. Android carries the NAVIGATION BAR
//      through the same fields because the app draws edge-to-edge, so applying
//      them there would be a pure regression. That is the `android` block.

import {Platform} from 'react-native';
import {getMushafLayout} from '../constants';

// iPhone 15 Pro, landscape — the device in the #349 report.
const W = 852;
const H = 393;
const ISLAND = 59; // Dynamic Island, reported on BOTH sides in landscape.

// iPhone 11 / X-class notch, landscape.
const NOTCH_W = 896;
const NOTCH_H = 414;
const NOTCH = 44;

// Android 3-button navigation bar in landscape, reported through the very same
// `insets.left` / `insets.right` fields.
const NAV_BAR = 48;

const baseOpts = {
  width: W,
  height: H,
  isTablet: false,
  headerHeight: 0,
  toolbarHeight: 0,
};

const insets = (left: number, right: number) => ({
  top: 0,
  bottom: 21,
  left,
  right,
});

describe('getMushafLayout — phone landscape display cutout (#349)', () => {
  it('insets the page by the Dynamic Island on both sides (iPhone 15 Pro)', () => {
    const m = getMushafLayout({...baseOpts, insets: insets(ISLAND, ISLAND)});

    // The pager item must stay one full window wide or `getItemLayout` in
    // main.tsx stops snapping.
    expect(m.screenWidth).toBe(W);

    expect(m.pageOffsetX).toBe(ISLAND);
    expect(m.pageWidth).toBe(W - ISLAND * 2); // 734
    expect(m.contentWidth).toBe(726);

    // Confirms this is the landscape branch (it alone sets this).
    expect(m.scrollContainerHeight).toBe(H);
  });

  it('insets the page by the notch on both sides (iPhone 11)', () => {
    const m = getMushafLayout({
      ...baseOpts,
      width: NOTCH_W,
      height: NOTCH_H,
      insets: insets(NOTCH, NOTCH),
    });

    expect(m.screenWidth).toBe(NOTCH_W);
    expect(m.pageOffsetX).toBe(NOTCH);
    expect(m.pageWidth).toBe(NOTCH_W - NOTCH * 2); // 808
    expect(m.contentWidth).toBe(800);
  });

  it('keeps the whole page box inside both safe edges (the actual #349 property)', () => {
    for (const [w, l, r] of [
      [W, ISLAND, ISLAND],
      [NOTCH_W, NOTCH, NOTCH],
      [W, ISLAND, 0], // hypothetical; see the generality test below
    ]) {
      const m = getMushafLayout({
        ...baseOpts,
        width: w,
        insets: insets(l, r),
      });

      // Nothing is drawn left of the left inset...
      expect(m.pageOffsetX).toBeGreaterThanOrEqual(l);
      // ...nor right of the right inset.
      expect(m.pageOffsetX + m.pageWidth).toBeLessThanOrEqual(w - r);
    }
  });

  it('is equivalent to centring whenever the insets are symmetric', () => {
    // Which is to say: on every real iOS device. The per-side math is kept for
    // generality, but it must not drift away from this equivalence.
    for (const [w, i] of [
      [W, ISLAND],
      [NOTCH_W, NOTCH],
    ]) {
      const m = getMushafLayout({...baseOpts, width: w, insets: insets(i, i)});
      expect(m.pageOffsetX).toBe((m.screenWidth - m.pageWidth) / 2);
    }
  });

  it('documents the real font cost on an iPhone 15 Pro', () => {
    // `fontSizeEst = contentWidth * 0.053` drives baseLineHeight and hence the
    // rendered glyph size, so every point of inset is font size. This is the
    // number the owner is deciding on.
    const before = getMushafLayout({...baseOpts, insets: insets(0, 0)});
    const after = getMushafLayout({
      ...baseOpts,
      insets: insets(ISLAND, ISLAND),
    });

    expect(before.contentWidth).toBe(844);
    expect(after.contentWidth).toBe(726);

    // Glyph size: 44.73pt -> 38.48pt.
    expect(before.contentWidth * 0.053).toBeCloseTo(44.73, 2);
    expect(after.contentWidth * 0.053).toBeCloseTo(38.48, 2);

    const lossPct = (1 - after.contentWidth / before.contentWidth) * 100;
    expect(lossPct).toBeCloseTo(14.0, 1);
  });

  it('handles a one-sided inset correctly (generality — NOT observed on iOS)', () => {
    // No iOS device reports this shape; UIKit always mirrors the housing. Kept
    // so the per-side math stays honest, and so the ~7% figure in the ledger is
    // reproducible as the hypothetical it is.
    const before = getMushafLayout({...baseOpts, insets: insets(0, 0)});
    const m = getMushafLayout({...baseOpts, insets: insets(ISLAND, 0)});

    expect(m.pageOffsetX).toBe(ISLAND);
    expect(m.pageWidth).toBe(W - ISLAND); // 793
    expect(m.contentWidth).toBe(785);
    expect((1 - m.contentWidth / before.contentWidth) * 100).toBeCloseTo(
      7.0,
      1,
    );
  });
});

describe('getMushafLayout — Android is never shrunk (regression guard)', () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it('ignores Android navigation-bar insets entirely', () => {
    // The app draws edge-to-edge on Android (translucent status bar +
    // transparent navigationBarColor), so in landscape `insets.left` or
    // `insets.right` is the ~48dp 3-button nav bar — NOT a cutout. Honouring it
    // would shrink the reader for no reason. This is the regression this gate
    // exists to catch; a gesture-navigation device reports 0 and cannot catch
    // it, which is exactly how it slipped through review once.
    Platform.OS = 'android';

    const withNavBar = getMushafLayout({
      ...baseOpts,
      insets: insets(NAV_BAR, 0),
    });
    const withNothing = getMushafLayout({...baseOpts, insets: insets(0, 0)});

    expect(withNavBar).toEqual(withNothing);
    expect(withNavBar.pageWidth).toBe(W);
    expect(withNavBar.pageOffsetX).toBe(0);
  });

  it('still applies the same insets on iOS', () => {
    Platform.OS = 'ios';

    const m = getMushafLayout({...baseOpts, insets: insets(NAV_BAR, NAV_BAR)});
    expect(m.pageOffsetX).toBe(NAV_BAR);
  });
});

describe('getMushafLayout — no movement where there is no cutout', () => {
  it('phone landscape is unchanged (pre-fix behaviour)', () => {
    const m = getMushafLayout({...baseOpts, insets: insets(0, 0)});

    // Values below are the pre-fix behaviour, derived by hand from the
    // original formula: pageWidth = width, contentWidth = width - 2*padding,
    // fontSizeEst = contentWidth * 0.053, baseLineHeight = fontSizeEst * 2.1.
    expect(m.screenWidth).toBe(852);
    expect(m.pageWidth).toBe(852);
    expect(m.pageOffsetX).toBe(0);
    expect(m.paddingHorizontal).toBe(4); // compact device (height < 700)
    expect(m.contentWidth).toBe(844);
    expect(m.baseLineHeight).toBeCloseTo(844 * 0.053 * 2.1);
    expect(m.scrollContainerHeight).toBe(393);
  });

  it('an absent inset object behaves exactly like zero insets', () => {
    const absent = getMushafLayout({...baseOpts, insets: null});
    const zeroed = getMushafLayout({
      ...baseOpts,
      insets: {top: 0, bottom: 0, left: 0, right: 0},
    });

    expect(absent).toEqual(zeroed);
  });

  it('phone portrait ignores horizontal insets entirely', () => {
    const portrait = {...baseOpts, width: H, height: W};

    expect(
      getMushafLayout({...portrait, insets: insets(ISLAND, ISLAND)}),
    ).toEqual(getMushafLayout({...portrait, insets: insets(0, 0)}));
  });

  it('both iPad branches ignore horizontal insets entirely', () => {
    const tabletLandscape = {
      width: 1366,
      height: 1024,
      isTablet: true,
      headerHeight: 0,
      toolbarHeight: 0,
    };
    const tabletPortrait = {...tabletLandscape, width: 1024, height: 1366};

    for (const opts of [tabletLandscape, tabletPortrait]) {
      expect(
        getMushafLayout({...opts, insets: insets(ISLAND, ISLAND)}),
      ).toEqual(getMushafLayout({...opts, insets: insets(0, 0)}));
    }
  });
});
