// @ai — the page draw report of the rotation stage (TECH_DEBT #272).
//
// When a turn leaves portrait, the native stage keeps a snapshot of the
// portrait page. A turn back to portrait shows it under the turn's snapshot
// until the new page has painted. The stage may show it only while it is
// still a true picture of the page. So the page tells the stage each time it
// draws again, for any reason (a highlight, a bookmark, the selection, the
// player's verse, the theme, the font, the verse units, the text, the safe
// area, the text size), and the stage drops the snapshot at once.
//
// The signal is the output, not a list of inputs: a commit of the page view
// (DKPageView in main.tsx) or of its renderer (SkiaPage, QCFPage). Every
// change of the page picture passes through one of these commits: the Canvas
// children of the renderers read no store, context or other external value
// (pageDrawReport.test.ts holds this). Two commits are not reported: the
// mount (the page draws for the first time) and the reveal (the page view
// shows the page that has just painted). A commit with a new page frame (a
// new size or safe area) is reported with `newFrame`: the native stage
// ignores it only while a turn is in progress (the turn's own commits, which
// its cover hides), and drops the snapshot for it at any other time (for
// example the safe area of the immersive mode).
import {useCallback, useInsertionEffect, useLayoutEffect, useRef} from 'react';
import type {EdgeInsets} from 'react-native-safe-area-context';
import type {MushafLayoutMetrics} from './constants';
import {useMushafRotationStage} from './MushafRotationStage';

/**
 * The frame of a page view: its size and its safe area. A turn changes it.
 */
export function pageFrameKey(
  metrics: MushafLayoutMetrics,
  insets: EdgeInsets,
): string {
  const {top, right, bottom, left} = insets;
  return `${JSON.stringify(metrics)}|${top},${right},${bottom},${left}`;
}

/** What the commit of the page view in progress changed. */
type CommitChange = {reveal: boolean; newFrame: boolean};
const NO_CHANGE: CommitChange = {reveal: false, newFrame: false};

/**
 * For the page view of `page`: reports its own commits and gives the
 * `onDraw` callback for its renderer. `ready` is the page view's reveal state
 * (true once the renderer has painted). `frame` is the page view's frame
 * (pageFrameKey). Neither the page view nor its renderer, which renders again
 * in the same commit, reports the reveal commit; both report a commit with a
 * new frame with `newFrame`.
 */
export function usePageDrawReport(
  page: number,
  ready: boolean,
  frame: string,
): () => void {
  const stage = useMushafRotationStage();
  // `ready` and `frame` at the last commit of the page view.
  const committedRef = useRef({ready, frame});
  // What the commit of the page view in progress changed: NO_CHANGE between
  // commits, so that a commit of the renderer alone is a plain draw. Both
  // refs change only in commit-phase effects, never in render: a render that
  // React discards changes nothing. The insertion effect runs in the
  // mutation phase, before every layout effect of the same commit (the
  // renderer's first, then the one below).
  const changeRef = useRef<CommitChange>(NO_CHANGE);
  useInsertionEffect(() => {
    const last = committedRef.current;
    changeRef.current = {
      reveal: ready && !last.ready,
      newFrame: frame !== last.frame,
    };
    committedRef.current = {ready, frame};
  });

  const report = useCallback(() => {
    const {reveal, newFrame} = changeRef.current;
    if (!reveal) stage.notePageDrawn(page, newFrame);
  }, [stage, page]);

  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    if (mountedRef.current) report();
    mountedRef.current = true;
    changeRef.current = NO_CHANGE;
  });
  return report;
}
