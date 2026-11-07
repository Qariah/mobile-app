// Qariah S35.2 — memory-pressure probe types.

/** A heap snapshot. All fields best-effort (a failed native read omits them).
 *  Android-only; iOS/web return {}. Sizes in MB unless noted. */
export interface HeapStats {
  /** Java/dalvik heap OOM ceiling (largeHeap raises this). */
  javaMaxMb?: number;
  javaTotalMb?: number;
  /** Used dalvik heap. Proximity to OOM = javaUsedMb / javaMaxMb. */
  javaUsedMb?: number;
  /** Debug.getMemoryInfo() composition split — the bitmap-vs-other discriminator. */
  summaryJavaHeapMb?: number;
  summaryGraphicsMb?: number;
  summaryNativeHeapMb?: number;
  summaryTotalPssMb?: number;
  summaryStackMb?: number;
  isLowRamDevice?: boolean;
  /** onTrimMemory level on a pressure event (10=RUNNING_LOW, 15=CRITICAL,
   *  80=COMPLETE, -1=onLowMemory). Absent on an on-demand getHeapStats() call. */
  trimLevel?: number;
}

export type QariahMemoryModuleEvents = {
  onMemoryPressure: (stats: HeapStats) => void;
};
