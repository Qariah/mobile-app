// Qariah — native main-thread (UI-thread) freeze watchdog types.

/** Emitted when the Android main thread was blocked for >= thresholdMs. */
export interface MainThreadStallEvent {
  /** How long the main thread had been unresponsive when detected (ms). */
  blockedMs: number;
  /** The configured detection threshold (ms). */
  thresholdMs: number;
  /** The main thread's stack trace at detection — names the blocked frame
   *  (e.g. a runBlocking/JNI call). Capped to ~4 KB. */
  mainStack: string;
}

export type QariahAnrWatchdogModuleEvents = {
  onMainThreadStall: (event: MainThreadStallEvent) => void;
};
