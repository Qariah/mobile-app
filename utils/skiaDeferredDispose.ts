import {runOnUIAsync} from 'react-native-worklets';

/**
 * An object that owns Skia native memory and exposes the JSI `dispose()`.
 * `SkParagraph`, `SkImage`, `SkPaint` and `SkFont` all match this shape.
 */
export interface SkiaDisposable {
  dispose: () => void;
}

/**
 * An empty worklet. It captures no value, so nothing crosses the runtime
 * boundary. It occupies one slot in the worklets UI queue and does no work.
 */
const uiQueueBarrier = () => {
  'worklet';
};

/**
 * Disposes Skia objects after the UI thread runs every draw that is already in
 * the worklets UI queue.
 *
 * Use this for an object that a `<Canvas>` renders. Dispose a
 * measurement-only object directly, because no draw ever holds it.
 *
 * ## The defect this closes (GH #458, Sentry QARIAHV2-3X)
 *
 * - `@shopify/react-native-skia` renders through `SkiaSGRoot.render()`. That
 *   method is `async` (`sksg/Reconciler.ts`), so its `redraw()` call lands in
 *   a microtask after the React commit.
 * - `redraw()` copies the live `SkParagraph` pointers into a recorder. It then
 *   queues the draw on the UI thread with `Rea.runOnUI`
 *   (`sksg/Container.native.ts`). The library offers no way to cancel that
 *   job, and `Container.unmount()` only sets a flag.
 * - React destroys the effects of a changed or deleted subtree before the UI
 *   thread drains that queue. A direct `dispose()` in an effect cleanup
 *   therefore frees a paragraph that a queued draw still holds.
 * - The UI thread then calls `recorder.play(picture)` on freed memory. The app
 *   aborts with `Attempted to access a disposed object`. A rotation of the
 *   Mushaf is the reliable trigger, because the orientation key in
 *   `components/mushaf/main.tsx` rebuilds every line in one commit.
 *
 * ## Why the barrier works
 *
 * `runOnUIAsync` pushes onto the same `runOnUIQueue` array that Skia's
 * `runOnUI` uses (`react-native-worklets/src/threads.native.ts`). The UI
 * thread replays that queue in push order, and the native `UIScheduler` keeps
 * the batches in order too. A barrier that the cleanup queues therefore runs
 * after every draw that can still hold the object.
 *
 * A draw that the app queues AFTER the cleanup is safe. This argument makes
 * no claim about WHEN the Skia commit happens, because two earlier versions
 * of this comment each named a mechanism and each named it wrong. Do not
 * reintroduce one.
 *
 * `redraw()` runs only from `SkiaSGRoot.render()`, and only after the `await`
 * on `updateContainer()` resolves (`sksg/Reconciler.ts`) — that is, only
 * after the Skia reconciler commits a tree. Every commit carries the newest
 * element that the app rendered. An object becomes disposable only because
 * the app rendered a replacement, or rendered nothing. Therefore every commit
 * that can precede a later `redraw()` already carries the replacement, and no
 * draw queued after the cleanup can reference the disposed object. On the
 * unmount path no later draw exists at all, because `redraw()` returns early
 * once `Container.unmount()` sets its flag.
 *
 * Two facts that a reader must not assume otherwise: the Skia renderer is
 * PERSISTENT, not a mutation renderer (`sksg/HostConfig.ts` sets
 * `supportsMutation: false`), and its host config returns
 * `DefaultEventPriority` from `resolveUpdatePriority`, so the work takes a
 * default lane and does NOT commit synchronously. Skia calls the async
 * `updateContainer`, never react-reconciler's `updateContainerSync`.
 *
 * The promise resolves back on the JS thread. The object never crosses a
 * runtime boundary.
 *
 * ## The stated limit — this is an improvement, not a proof
 *
 * `IOSUIScheduler::scheduleOnUI` short-circuits when the caller is already on
 * the main thread (`react-native-worklets/apple/worklets/apple/
 * IOSUIScheduler.mm`): it runs the batch immediately and never touches the
 * FIFO `uiJobs_` queue. A barrier that this path carries can therefore
 * overtake an earlier batch that still waits in `uiJobs_`. Nobody has shown
 * that React Native 0.85 runs these cleanups on the main thread, so the case
 * is unproven. Treat the barrier as a verified happy-path improvement.
 */
export function disposeAfterPendingDraws(
  objects: ReadonlyArray<SkiaDisposable | null | undefined>,
): void {
  const live = objects.filter(
    (object): object is SkiaDisposable => object != null,
  );
  if (live.length === 0) {
    return;
  }

  const disposeAll = () => {
    for (const object of live) {
      try {
        object.dispose();
      } catch {
        // The object is already gone. There is nothing left to free.
      }
    }
  };

  try {
    // `runOnUIAsync` builds its promise with a resolve callback only. It has
    // no reject path, so this call needs no rejection handler.
    //
    // A throw in ANY worklet is therefore permanent. `flushUIQueue` runs the
    // batch with a bare `queue.forEach`, so a throw aborts the loop and no
    // later `jobResolve` runs. Every barrier behind it waits for the life of
    // the process and holds its `live` array. A Skia draw is one of the jobs
    // most likely to throw, which puts the two paths next to each other.
    runOnUIAsync(uiQueueBarrier).then(disposeAll);
  } catch {
    // The worklets runtime is unavailable, so no UI-thread draw is in flight.
    // Dispose now. This is the pre-fix behaviour.
    disposeAll();
  }
}
