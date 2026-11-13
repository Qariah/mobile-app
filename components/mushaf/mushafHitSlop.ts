// @ai-generated
/**
 * Hit slops that give the small buttons of the Mushaf reader a 44 pt hit
 * area with no visible change (UX critique 2026-11-11, design rule T1: "on
 * the small phone width too"). On the Galaxy A10s (360 pt) the bar of
 * `MushafPlayerBar.tsx` had Stop and Playback options at 36.5 pt, Pause and
 * the skip chevrons at 38.5 pt, and the Mushaf settings icon of the header
 * (`main.tsx`) at 34.5 pt. None had a hitSlop.
 *
 * A hit slop does not move or resize a button. Two rules keep a tap on the
 * right button:
 *  - Two hit areas never overlap. In the centre group of the bar the gap
 *    between two buttons is 8 pt, so the two facing sides together grow
 *    less than the gap (`mushafHitSlop.test.ts` checks it at four widths).
 *  - A view that comes later in the tree takes a touch in its bounds before
 *    the hit slop of an earlier view can. The verse line under the active
 *    row comes later, so the bar draws it in a `pointerEvents="none"` view.
 *
 * The sizes come from the styles of the two files; `ms` is `moderateScale`.
 * `MushafPlayerBar.hitArea.test.tsx` checks that the rendered styles match.
 */
import type {Insets} from 'react-native';

export const MIN_HIT_AREA = 44;

type Scale = (size: number) => number;

/** The space that a box of this size needs on each side to reach 44 pt. */
const evenly = (size: number): number => Math.max(0, (MIN_HIT_AREA - size) / 2);

/** The space that a box of this size needs on one side to reach 44 pt. */
const oneSide = (size: number): number => Math.max(0, MIN_HIT_AREA - size);

/** The same growth on all four sides, for a button with free space around it. */
export function evenHitSlop(width: number, height: number = width): Insets {
  const x = evenly(width);
  const y = evenly(height);
  return {top: y, bottom: y, left: x, right: x};
}

/** The sizes that the styles of `MushafPlayerBar.tsx` give its buttons. */
export function playerBarSizes(ms: Scale) {
  return {
    /** `edgeButton`: Search (idle), Stop (active), Playback options. */
    edge: ms(36),
    /** `playButtonRect`: Play in the idle row. */
    play: ms(42),
    /** `playPauseButton`: Pause / Play in the active row. */
    playPause: ms(38),
    /** `chevronButton`: the icon (22) with paddingHorizontal 12. */
    chevronWidth: ms(22) + 2 * ms(12),
    /** `chevronButton`: the icon (22) with paddingVertical 8. */
    chevronHeight: ms(22) + 2 * ms(8),
    /** `controlsCenter` gap between a chevron and Pause. */
    centreGap: ms(8),
    /** `idleRow` height. */
    idleRowHeight: ms(52),
  };
}

/**
 * The hit slops of the bar.
 *
 * The idle row is 52 pt tall and each button sits in its middle, so each
 * button grows the same on all sides and stays in the row.
 *
 * The active row is the top row of the bar, and the verse line is under it.
 * The page is above the bar, so a button there grows down over the verse
 * line and never up.
 */
export function playerBarHitSlops(ms: Scale) {
  const s = playerBarSizes(ms);
  const downOnly = (width: number, height: number): Insets => ({
    top: 0,
    bottom: oneSide(height),
    left: evenly(width),
    right: evenly(width),
  });
  return {
    idleEdge: evenHitSlop(s.edge),
    idlePlay: evenHitSlop(s.play),
    activeEdge: downOnly(s.edge, s.edge),
    playPause: downOnly(s.playPause, s.playPause),
    chevron: downOnly(s.chevronWidth, s.chevronHeight),
  };
}

/** `headerIcon` of `main.tsx`: the icon (22) with padding 6. */
export function headerIconSize(ms: Scale): number {
  return ms(22) + 2 * ms(6);
}
