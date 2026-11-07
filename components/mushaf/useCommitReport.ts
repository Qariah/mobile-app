// @ai — the renderer half of the page draw report (TECH_DEBT #272; see
// pageDrawReport.ts). SkiaPage and QCFPage call it at their top level.
import {useLayoutEffect, useRef} from 'react';

/**
 * Calls `onDraw` after each commit of the calling component except the first
 * (its mount). A commit is the only way that the component changes what it
 * draws.
 */
export function useCommitReport(onDraw: (() => void) | undefined): void {
  const mountedRef = useRef(false);
  const onDrawRef = useRef(onDraw);
  onDrawRef.current = onDraw;
  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    onDrawRef.current?.();
  });
}
