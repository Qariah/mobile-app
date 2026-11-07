package expo.modules.qariahmemory

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.Debug
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Qariah S35.2 — REPORT-ONLY memory-pressure field probe (Android).
 *
 * The media3/Glide OOM (prod vc1255 ~7.07%) can't be reproduced on hand hardware
 * (it's the 6-8 GB Samsung/Android-16 cohort), so we let the affected devices tell
 * us — from the field — what is filling the heap *before* they OOM. This module
 * exposes:
 *   - getHeapStats(): the Java-heap ceiling (Runtime) + the Debug.getMemoryInfo()
 *     composition split (summary.java-heap / graphics / native-heap / total-pss).
 *     The graphics/java-heap split is THE discriminator: bitmap-dominated (Glide)
 *     vs media3-buffer vs leak.
 *   - an `onMemoryPressure` event fired on onTrimMemory(RUNNING_LOW/CRITICAL/COMPLETE)
 *     — Android raises these seconds before a Java OOM on the affected device.
 *
 * INERT BY DEFAULT. Does nothing until JS calls setEnabled(true) AND a listener is
 * attached (OnStartObserving). JS gates that on the build flag `memoryPressureProbe`
 * + the remote `diagnostics_mode` payload `memoryProbe` opt-in (it applies on a later
 * cold start, not live). Every read is
 * defensive (best-effort); a stats read must never throw into the app.
 */
class QariahMemoryModule : Module() {
  // Set true only when JS (build + remote flag) activates the probe.
  @Volatile
  private var enabled = false

  private val trimCallback = object : ComponentCallbacks2 {
    // TRIM_MEMORY_RUNNING_* are deprecated as of API 34 and the system stops
    // delivering them to foreground apps on Android 14+ — i.e. they will NOT fire
    // on the affected Android-16 cohort. So this onTrimMemory hook is a BEST-EFFORT
    // secondary signal (older devices + UI_HIDDEN); the PRIMARY pre-OOM detector is
    // the JS heap-proximity poller in memoryWatch.ts (API-level-independent).
    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
      if (!enabled) return
      // Pre-OOM foreground-pressure levels only (UI_HIDDEN/BACKGROUND levels are
      // routine and not OOM-predictive). RUNNING_LOW=10, RUNNING_CRITICAL=15,
      // COMPLETE=80.
      if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
        level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level == ComponentCallbacks2.TRIM_MEMORY_COMPLETE
      ) {
        emitPressure(level)
      }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {}

    @Deprecated("required by ComponentCallbacks2")
    override fun onLowMemory() {
      if (enabled) emitPressure(-1)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("QariahMemory")

    Events("onMemoryPressure")

    // Idempotent activation toggle — the single point JS uses to honor the build
    // flag + the remote opt-in. setEnabled(false) makes the module fully inert.
    Function("setEnabled") { value: Boolean ->
      enabled = value
    }

    // On-demand heap snapshot. Cheap enough for a throttled JS sampler.
    Function("getHeapStats") {
      heapStatsMap()
    }

    // Tie the native ComponentCallbacks2 registration to JS having a listener —
    // a second inert-until-used gate on top of `enabled`.
    OnStartObserving {
      appContext.reactContext?.registerComponentCallbacks(trimCallback)
    }
    OnStopObserving {
      appContext.reactContext?.unregisterComponentCallbacks(trimCallback)
    }
  }

  private fun emitPressure(trimLevel: Int) {
    try {
      val map = heapStatsMap()
      map["trimLevel"] = trimLevel
      sendEvent("onMemoryPressure", map)
    } catch (_: Throwable) {
      // report-only — a probe must never throw into an onTrimMemory callback
    }
  }

  private fun heapStatsMap(): MutableMap<String, Any> {
    val map = mutableMapOf<String, Any>()
    try {
      val rt = Runtime.getRuntime()
      // Java/dalvik heap — the OOM ceiling is javaMaxMb; javaUsedMb/javaMaxMb is
      // the proximity to the Java OOM boundary (largeHeap raises javaMaxMb).
      map["javaMaxMb"] = rt.maxMemory() / MB
      map["javaTotalMb"] = rt.totalMemory() / MB
      map["javaUsedMb"] = (rt.totalMemory() - rt.freeMemory()) / MB

      // Debug.getMemoryInfo summary stats (own process; no permission). Values are
      // KB strings on API 23+ (minSdk 24). This split is the composition
      // discriminator — a large graphics/java-heap at pressure ⇒ bitmap-dominated.
      val mi = Debug.MemoryInfo()
      Debug.getMemoryInfo(mi)
      map["summaryJavaHeapMb"] = stat(mi, "summary.java-heap") / 1024
      map["summaryGraphicsMb"] = stat(mi, "summary.graphics") / 1024
      map["summaryNativeHeapMb"] = stat(mi, "summary.native-heap") / 1024
      map["summaryTotalPssMb"] = stat(mi, "summary.total-pss") / 1024
      map["summaryStackMb"] = stat(mi, "summary.stack") / 1024

      val am = appContext.reactContext
        ?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      if (am != null) {
        map["isLowRamDevice"] = am.isLowRamDevice
      }
    } catch (_: Throwable) {
      // best-effort; return whatever was gathered
    }
    return map
  }

  private fun stat(mi: Debug.MemoryInfo, key: String): Long =
    mi.getMemoryStat(key)?.toLongOrNull() ?: -1L

  companion object {
    private const val MB = 1024L * 1024L
  }
}
