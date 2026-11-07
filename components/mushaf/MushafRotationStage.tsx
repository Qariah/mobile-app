// @ai — keeps the Mushaf page coherent while iOS rotates the interface.
//
// On iOS, UIKit animates the screen bounds from the old size to the new size
// over about 300 ms. The reader sizes its pages in JS from the window size,
// Skia draws them asynchronously, and the list remounts for #258 and needs a
// few frames to reach its start page. Without help the screen shows a
// cropped page, a page beside empty space, two pages side by side, a
// neighbour page, or a blank page. The native stage (modules/rotation-stage)
// covers the reader with the old frame, moves that frame with the UIKit
// animation, and lifts the cover when the new layout is ready. This component
// tells the stage where the page text sits before and after the turn, and
// when the page to show has painted. On Android and web the stage is a plain
// View.
import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {View, useWindowDimensions, type ColorValue} from 'react-native';
import {
  RotationStage,
  type RotationStageHandle,
} from '@/modules/rotation-stage';
import {runAfterPendingDraws} from '@/utils/skiaDeferredDispose';
import type {MushafLayoutMetrics} from './constants';
import {stageMapping, type StageGeometry} from './rotationStageGeometry';
import {
  isTurnReady,
  layoutOrientation,
  notePainted,
  startTurn,
  waitsForMorph,
  type TurnProgress,
} from './rotationTurnState';

export type RotationStageNotes = {
  /** A page has drawn its text (SkiaPage or QCFPage `onReady`). */
  notePagePainted: (page: number) => void;
  /**
   * A page has drawn again, for any reason: a commit after its mount, but
   * the reveal (pageDrawReport.ts). The stage then drops its portrait
   * snapshot of that page: the snapshot may no longer show what the page
   * shows (#272). `newFrame`: the commit brought a new page size or safe
   * area; the native stage ignores such a draw only during a turn.
   */
  notePageDrawn: (page: number, newFrame: boolean) => void;
  /** The phone-landscape page scroller of `page` scrolled to `y`. */
  noteScrollY: (page: number, y: number) => void;
};

// Outside a stage (tests, other screens) the notes do nothing.
const NO_NOTES: RotationStageNotes = {
  notePagePainted: () => undefined,
  notePageDrawn: () => undefined,
  noteScrollY: () => undefined,
};

const StageNotesContext = createContext<RotationStageNotes>(NO_NOTES);

export function useMushafRotationStage(): RotationStageNotes {
  return useContext(StageNotesContext);
}

/** The `testID` of the `DKPageView` of `page` (main.tsx). */
export function mushafPageTestID(page: number): string {
  return `mushaf-page-${page}`;
}

type Turn = {token: number; from: StageGeometry};

/** A turn that never becomes ready stops waiting after this time (the native cover has its own timeout). */
const TURN_WAIT_MS = 1500;
/**
 * List and continuous modes report no per-page paint. Their rows draw their
 * Arabic with Skia, over the frames after the remount. Wait at least this
 * long, then for an idle JS thread (no row left to render), then for the
 * draws already queued (the barrier in `report`).
 */
const UNPAGED_SETTLE_MS = 150;
const UNPAGED_IDLE_TIMEOUT_MS = 600;

/** Calls `fn` when the JS thread is idle, or after `timeout` ms at most. */
function whenIdle(fn: () => void, timeout: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, {timeout});
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

type Props = {
  orientation: 'portrait' | 'landscape';
  metrics: MushafLayoutMetrics;
  currentPage: number;
  /**
   * The horizontal Mushaf pager (one page or two facing pages per item). Its
   * pages report their paint, and the stage checks that the page to show is
   * on screen.
   */
  paged: boolean;
  isBookLayout: boolean;
  backdropColor: ColorValue;
  /**
   * The status bar is hidden (the reader's immersive mode). A change moves
   * the page labels, sometimes with no commit of the page (a Home-button
   * iPhone in landscape has no status bar to hide): the stage drops its
   * portrait snapshot (#272).
   */
  statusBarHidden?: boolean;
  children: React.ReactNode;
};

export function MushafRotationStage({
  orientation,
  metrics,
  currentPage,
  paged,
  isBookLayout,
  backdropColor,
  statusBarHidden = false,
  children,
}: Props) {
  const stageRef = useRef<RotationStageHandle>(null);
  const scrollRef = useRef({page: 0, y: 0});
  const geometry: StageGeometry = {
    orientation,
    metrics,
    page: currentPage,
    paged,
    isBookLayout,
    scrollY: scrollRef.current.page === currentPage ? scrollRef.current.y : 0,
  };

  // The geometry of the last commit. A turn starts from it.
  const committedRef = useRef<StageGeometry | null>(null);
  useEffect(() => {
    committedRef.current = geometry;
  });

  // The number of turns that started. Read in render, written only in the
  // layout effect below, so that a render React discards cannot use up a
  // token.
  const startedTurnsRef = useRef(0);
  const turn = useMemo<Turn | null>(() => {
    const from = committedRef.current;
    if (!from || from.orientation === orientation) return null;
    return {token: startedTurnsRef.current + 1, from};
    // A turn is a change of orientation; the committed geometry only feeds it.
  }, [orientation]);

  // The turn that waits to be ready. It starts in the layout effect of the
  // commit that remounts the list, before any page of the new list can
  // report: paints of the old list never count.
  //
  // The page to show is the page of the commit before the turn (#258). Every
  // new layout shows that page: the single-page list starts at it, and a
  // spread keeps it (main.tsx `pageForSpread`), on the left or the right. Do
  // not derive it from `metrics`: on iPad the first render of a turn still
  // has the old layout's metrics (the measured container catches up one
  // render later), so `metrics.facingPages` names the old layout there.
  const progressRef = useRef<TurnProgress | null>(null);
  const fromFacingPagesRef = useRef(false);
  useLayoutEffect(() => {
    if (!turn) return;
    startedTurnsRef.current = turn.token;
    progressRef.current = startTurn(turn.token, orientation, turn.from.page);
    fromFacingPagesRef.current = turn.from.metrics.facingPages;
    // `orientation` changes only together with `turn`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);

  // The new page scroller starts at the top.
  const mapping = turn
    ? stageMapping(turn.token, turn.from, {...geometry, scrollY: 0})
    : null;

  // The page that the native stage may keep a portrait snapshot of
  // (TECH_DEBT #272): the reader's page in the pager, once it has painted
  // (QCF pages have no reveal gate, so the native opacity check alone cannot
  // tell). The native stage also checks that the page is at rest and opaque,
  // and drops the snapshot when the page draws again (`notePageDrawn`).
  const paintedPagesRef = useRef(new Set<number>());
  const [, setPaintedCurrent] = useState(0);
  useLayoutEffect(() => {
    // A turn remounts the list: its pages paint again.
    if (!turn) return;
    paintedPagesRef.current.clear();
    setPaintedCurrent(n => n + 1);
  }, [turn]);
  const pictureTestID =
    paged && paintedPagesRef.current.has(currentPage)
      ? mushafPageTestID(currentPage)
      : null;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  // Changes that move what the page shows with no commit of the page: the
  // status bar (the page labels' offset) and the system text size (the
  // labels scale natively). Each drops the portrait snapshot (#272).
  const {fontScale} = useWindowDimensions();
  const chromeRef = useRef({statusBarHidden, fontScale});
  useLayoutEffect(() => {
    const last = chromeRef.current;
    if (
      last.statusBarHidden === statusBarHidden &&
      last.fontScale === fontScale
    ) {
      return;
    }
    chromeRef.current = {statusBarHidden, fontScale};
    stageRef.current?.pageDrew(false);
  }, [statusBarHidden, fontScale]);

  const pagedRef = useRef(paged);
  pagedRef.current = paged;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const api = useMemo(() => {
    const report = () => {
      const done = progressRef.current;
      if (!done) return;
      progressRef.current = null;
      // In the pager the stage also waits until the target page's view is
      // on screen (the remounted list can show a neighbour page first).
      // The metrics are the new layout's by now: its page has painted.
      const isPaged = pagedRef.current;
      const layouts = {
        orientation: done.orientation,
        paged: isPaged,
        inScroller: !!metricsRef.current.scrollContainerHeight,
        fromFacingPages: fromFacingPagesRef.current,
      };
      // The native stage removes its cover with a cut.
      const options = {
        testID: isPaged ? mushafPageTestID(done.target) : null,
        waitForMorph: waitsForMorph(layouts),
      };
      // The page text has registered, but Skia queues its draw only after
      // this report. A macrotask lets Skia queue the draw; the UI queue
      // barrier then waits until the draw has run.
      setTimeout(() => {
        runAfterPendingDraws(() => {
          stageRef.current?.markReady(done.token, done.orientation, options);
        });
      }, 0);
    };
    const notes: RotationStageNotes = {
      notePagePainted: page => {
        paintedPagesRef.current.add(page);
        if (page === currentPageRef.current) setPaintedCurrent(n => n + 1);
        const current = progressRef.current;
        if (!current) return;
        progressRef.current = notePainted(
          current,
          page,
          layoutOrientation(metricsRef.current),
        );
        if (isTurnReady(progressRef.current)) report();
      },
      notePageDrawn: (page, newFrame) => {
        if (page === currentPageRef.current) {
          stageRef.current?.pageDrew(newFrame);
        }
      },
      noteScrollY: (page, y) => {
        scrollRef.current = {page, y};
      },
    };
    // A touch ends the turn: the user now drives the list. The native stage
    // lifts its cover on the same touch.
    const cancel = () => {
      progressRef.current = null;
    };
    return {notes, report, cancel};
  }, []);

  useEffect(() => {
    if (!turn) return;
    let cancelIdle: (() => void) | undefined;
    const settle = paged
      ? undefined
      : setTimeout(() => {
          cancelIdle = whenIdle(api.report, UNPAGED_IDLE_TIMEOUT_MS);
        }, UNPAGED_SETTLE_MS);
    const timer = setTimeout(() => {
      if (progressRef.current?.token === turn.token) {
        progressRef.current = null;
      }
    }, TURN_WAIT_MS);
    return () => {
      clearTimeout(settle);
      cancelIdle?.();
      clearTimeout(timer);
    };
  }, [turn, paged, api]);

  return (
    <StageNotesContext.Provider value={api.notes}>
      <RotationStage
        ref={stageRef}
        style={{flex: 1, overflow: 'hidden'}}
        mapping={mapping}
        backdropColor={backdropColor}
        pictureTestID={pictureTestID}>
        {/* The stage moves its content during a turn. A plain wrapper keeps
            the list one child of the native view, and its transform off the
            list, whose `inverted` prop owns one. */}
        <View style={{flex: 1}} collapsable={false} onTouchStart={api.cancel}>
          {children}
        </View>
      </RotationStage>
    </StageNotesContext.Provider>
  );
}
