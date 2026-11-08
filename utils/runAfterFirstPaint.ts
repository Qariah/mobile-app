// @ai Qariah (A10s performance review, recommendation 2) — a real "after
// interactions" for React Native 0.86.
//
// React Native 0.85+ deprecates InteractionManager, and runAfterInteractions
// runs the task on the next tick (setImmediate). Code that renders a first
// batch and "the rest after interactions" so rendered everything in one pass:
// on a Samsung A10s a reciter profile mounted every surah row at once. This
// waits for two frames (the first batch is on screen), then `delayMs` (for
// example a screen transition), then runs the task.
export function runAfterFirstPaint(
  task: () => void,
  delayMs = 0,
): {cancel: () => void} {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (!cancelled) task();
      }, delayMs);
    });
  });
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    },
  };
}
