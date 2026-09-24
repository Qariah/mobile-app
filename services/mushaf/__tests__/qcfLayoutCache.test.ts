// @ai
// GH #364 — the QCF layout cache half.
//
// The cache key is `(fontFamily, pageNumber)` and carries NO orientation, so
// it may only ever hold orientation-INDEPENDENT measurements. It used to
// store a concrete `fontSize`, which meant a page measured in portrait handed
// a portrait font size back to a landscape render. Plumbing layout metrics
// into QCFPage would have silently no-opped on any already-cached page.
//
// It now stores `widestRef` (a width at the reference font size) and the
// render size is derived from that plus the live content width.

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string | number>();
  return {
    // Exposed so a test can seed a raw, legacy-shaped blob without going
    // through setPageLayout (which would also populate the memory cache).
    __store: store,
    createMMKV: () => ({
      getString: (k: string) => store.get(k) as string | undefined,
      getNumber: (k: string) => store.get(k) as number | undefined,
      set: (k: string, v: string | number) => store.set(k, v),
      clearAll: () => store.clear(),
    }),
  };
});

import {
  qcfFontSizeForContentWidth,
  QCF_FILL_RATIO,
  QCF_REF_FONT_SIZE,
} from '../qcfFontSizing';
import {
  qcfLayoutCacheService,
  type QCFPageLayoutMetrics,
} from '../QCFLayoutCacheService';
import {getMushafLayout} from '../../../components/mushaf/constants';

// Pixel 3 logical points.
const PORTRAIT = getMushafLayout({
  width: 392.7,
  height: 785.5,
  isTablet: false,
});
const LANDSCAPE = getMushafLayout({
  width: 785.5,
  height: 392.7,
  isTablet: false,
});

describe('QCFPageLayoutMetrics is orientation-independent', () => {
  it('carries no orientation-specific fontSize field', () => {
    const value: QCFPageLayoutMetrics = {
      widestRef: 900,
      lineWidthsAtRef: [{lineIndex: 0, width: 900}],
    };
    qcfLayoutCacheService.setPageLayout(100, 'QCF_P100', value);
    const read = qcfLayoutCacheService.getPageLayout(100, 'QCF_P100');
    expect(read).not.toHaveProperty('fontSize');
    expect(read?.widestRef).toBe(900);
  });

  it('rejects a v1-shaped blob that carries fontSize instead of widestRef', () => {
    // A schema-1 entry that somehow survived (belt and braces — the
    // constructor also clearAll()s on a version bump). It must not reach the
    // renderer: its fontSize is baked to whatever orientation measured it.
    // Seeded straight into storage so the JSON validator is what answers.
    const {__store} = jest.requireMock('react-native-mmkv') as {
      __store: Map<string, string | number>;
    };
    __store.set(
      'qcf:QCF_P200:200',
      JSON.stringify({
        fontSize: 26.4,
        lineWidthsAtRef: [{lineIndex: 0, width: 900}],
      }),
    );
    expect(
      qcfLayoutCacheService.getPageLayout(200, 'QCF_P200'),
    ).toBeUndefined();
  });
});

describe('font size derives from the LIVE content width (GH #364)', () => {
  const widestRef = 900;

  it('sizes the calibration line to fill the content width', () => {
    const size = qcfFontSizeForContentWidth(widestRef, 500);
    const rendered = (widestRef * size) / QCF_REF_FONT_SIZE;
    expect(rendered).toBeCloseTo(500 * QCF_FILL_RATIO, 6);
  });

  it('gives landscape a materially larger size than portrait, from ONE cached measurement', () => {
    const portraitSize = qcfFontSizeForContentWidth(
      widestRef,
      PORTRAIT.contentWidth,
    );
    const landscapeSize = qcfFontSizeForContentWidth(
      widestRef,
      LANDSCAPE.contentWidth,
    );
    // The #364 symptom as a renderer-independent ratio: the portrait content
    // box is ~48% of the landscape one on a Pixel 3, so a page stuck on the
    // portrait constants rendered at roughly half scale.
    expect(PORTRAIT.contentWidth / LANDSCAPE.contentWidth).toBeCloseTo(
      0.4845,
      3,
    );
    expect(landscapeSize / portraitSize).toBeCloseTo(
      LANDSCAPE.contentWidth / PORTRAIT.contentWidth,
      6,
    );
  });

  it('never divides by a zero or missing calibration width', () => {
    expect(qcfFontSizeForContentWidth(0, 500)).toBe(0);
    expect(qcfFontSizeForContentWidth(-1, 500)).toBe(0);
  });
});
