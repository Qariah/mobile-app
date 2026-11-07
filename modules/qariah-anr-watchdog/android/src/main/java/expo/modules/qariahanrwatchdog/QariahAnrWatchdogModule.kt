package expo.modules.qariahanrwatchdog

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// REPORT-ONLY native main-thread (UI-thread) freeze watchdog — the standard
// "ANR-WatchDog" technique. A background daemon thread posts a trivial ticker to
// the main Looper every `intervalMs`; the ticker (which runs ON the main thread)
// stamps `lastTickAt`. If `now - lastTickAt` exceeds `thresholdMs`, the main
// thread hasn't processed a message for that long — it is BLOCKED — so we capture
// the main thread's current stack and emit `onMainThreadStall` to JS.
//
// WHY THIS EXISTS: the JS-thread heartbeat (diagnostic-js-stall) only sees JS
// thread blocks; a native main-thread freeze (e.g. an expo-audio runBlocking
// deadlock during playback) leaves the JS thread alive but the UI frozen, so the
// heartbeat is blind and the only other evidence is a platform ANR (needs Play
// volume to surface). This catches that class directly + names the blocked stack.
//
// The event is sent from the BACKGROUND thread (never via the main Handler — it's
// the thing that's blocked) → it reaches the JS thread, which is alive during a
// pure UI-thread block. Inert until setEnabled(true); the JS caller gates it
// behind the diagnostics cohort + a remote kill-switch + a build flag. Pure
// telemetry — it never touches the main thread's work or the app's behavior.
class QariahAnrWatchdogModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile private var lastTickAt = 0L // uptimeMillis the main thread last ran the ticker
  @Volatile private var running = false
  private var watchdog: Thread? = null
  private var intervalMs = 1000L
  private var thresholdMs = 4000L

  // Runs ON the main thread when it gets to it — proof the main looper is alive.
  private val ticker = Runnable { lastTickAt = SystemClock.uptimeMillis() }

  override fun definition() = ModuleDefinition {
    Name("QariahAnrWatchdog")
    Events("onMainThreadStall")

    // Activate / deactivate. Inert until on=true. interval/threshold in ms.
    Function("setEnabled") { on: Boolean, interval: Int, threshold: Int ->
      if (interval > 0) intervalMs = interval.toLong()
      if (threshold > 0) thresholdMs = threshold.toLong()
      if (on) start() else stop()
    }

    OnDestroy { stop() }
  }

  private fun start() {
    if (running) return
    running = true
    lastTickAt = SystemClock.uptimeMillis()
    val t = Thread({ loop() }, "qariah-anr-watchdog").apply { isDaemon = true }
    watchdog = t
    t.start()
  }

  private fun stop() {
    running = false
    watchdog?.interrupt()
    watchdog = null
  }

  private fun loop() {
    var reported = false // one report per stall episode (re-armed on recovery)
    while (running && !Thread.currentThread().isInterrupted) {
      mainHandler.post(ticker)
      try {
        Thread.sleep(intervalMs)
      } catch (e: InterruptedException) {
        break
      }
      // Time since the main thread last processed a message. Grows while blocked,
      // resets to ~0 each interval while healthy.
      val blockedMs = SystemClock.uptimeMillis() - lastTickAt
      if (blockedMs >= thresholdMs) {
        if (!reported) {
          reported = true
          captureStall(blockedMs)
        }
      } else {
        reported = false // main thread is keeping up — re-arm for the next episode
      }
    }
  }

  private fun captureStall(blockedMs: Long) {
    val stack =
      try {
        Looper.getMainLooper().thread.stackTrace.joinToString("\n") {
          "${it.className}.${it.methodName}(${it.fileName}:${it.lineNumber})"
        }
      } catch (e: Throwable) {
        ""
      }
    try {
      sendEvent(
        "onMainThreadStall",
        mapOf(
          "blockedMs" to blockedMs.toInt(),
          "thresholdMs" to thresholdMs.toInt(),
          // Cap the payload — a full main stack can be large; the top frames name
          // the culprit.
          "mainStack" to (if (stack.length > 4000) stack.substring(0, 4000) else stack),
        ),
      )
    } catch (e: Throwable) {
      // report-only — the watchdog thread must NEVER throw.
    }
  }
}
