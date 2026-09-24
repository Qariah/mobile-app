// @ai
// Pure QCF page-font sizing. Deliberately dependency-free (no native
// imports) so it is unit-testable and so the sizing rule lives in one place
// instead of inline in the renderer.

/** Reference size the cached `widestRef` / `lineWidthsAtRef` widths are measured at. */
export const QCF_REF_FONT_SIZE = 100;

/**
 * Fraction of the available content width the widest calibration line should
 * fill. The KFGQPC page fonts are designed so the widest line fills the page.
 */
export const QCF_FILL_RATIO = 0.97;

/**
 * Render font size for a QCF page, given its (orientation-independent)
 * calibration width and the LIVE content width.
 *
 * Pure and linear in `contentWidth`. This is what lets the renderer follow
 * rotation and iPad layout without re-measuring the page: the measurement
 * (`widestRef`) is cached, the size derived from it is not.
 */
export function qcfFontSizeForContentWidth(
  widestRef: number,
  contentWidth: number,
): number {
  if (!(widestRef > 0)) return 0;
  return ((contentWidth * QCF_FILL_RATIO) / widestRef) * QCF_REF_FONT_SIZE;
}
