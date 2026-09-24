package expo.modules.qariahbootsplash

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.res.Configuration
import android.graphics.Outline
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowInsetsController
import android.widget.FrameLayout
import android.widget.ImageView
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Qariah (ANR WS-C, hypothesis H1): a non-blocking boot splash for Android.
 *
 * THE PROBLEM. expo-splash-screen holds the splash with an OnPreDrawListener
 * that returns `false` until JS calls hideAsync(). The app window cannot draw
 * its first frame during that hold. WindowManager shows a new window surface
 * only after its first draw, and InputDispatcher gives input focus only to a
 * visible window. So for the whole hold (12-25 s on itel/Infinix/Tecno
 * phones) the app is the focused application with no focused window. A BACK
 * or VOLUME key in that time waits 5 s and then ANRs "No focused window".
 *
 * THE TREATMENT. MainActivity calls SplashScreenManager.hide() at once, so the
 * window draws (and gets input focus) at the first traversal. This object adds
 * a full-window native view on top of the content that copies the splash look
 * (splash background colour + the 288 dp splash logo clipped to a 192 dp
 * circle, the same geometry as androidx core-splashscreen and the Android 12+
 * system splash). JS removes the view at the same points where it calls
 * SplashScreen.hideAsync() today (utils/bootSplash.ts). A native time limit
 * (OVERLAY_TIME_LIMIT_MS) removes it if JS never does.
 *
 * NO MAIN-THREAD PREFS (review R5). The flag is a marker file in
 * noBackupFilesDir (so a backup never restores it to another device). The main
 * thread only stat()s it (and, when it exists, the fallback marker) in
 * Application.onCreate. Every write (flag, crash-guard state, fallback marker)
 * runs on one background thread, as temp file + rename, without fsync.
 *
 * LOGO (review R6, reworked per lead ruling §7.13). When the flag is on, an
 * early decode starts in Application.onCreate on its own thread at DEFAULT
 * priority. addOverlay uses that result if it is already done; otherwise it
 * decodes on the main thread (the pre-R6 behaviour) and discards the early
 * result. So the overlay never shows a colour-only frame. One log line per
 * launch: `logo source=early decode_ms=N` or
 * `logo source=main main_decode_ms=N early_started=… early_ms_so_far=…`.
 *
 * NOTE: in treatment the window draws early, so Android "Displayed" and the
 * Sentry app-start span move earlier. That is NOT a faster boot. The log line
 * "boot splash dismissed" is the "app ready" moment in both arms.
 *
 * THE FLAG. Fail-closed. JS writes the PostHog value (marker present = on) for
 * the NEXT launch. A missing marker means today's behaviour. A lab build
 * (BuildConfig.QARIAH_LAB) also accepts the launch intent extras
 * `qariah_lab_nonblocking_splash` (boolean) and `qariah_lab_splash_variant`
 * ("c1b": the content view stays INVISIBLE until dismiss) for a same-build A/B.
 * With `--ez qariah_lab_persist true` a lab launch also writes the arm to the
 * marker files, so a later real launcher tap uses it; JS then does not
 * overwrite it. `--es qariah_lab_splash_variant clear` removes the lab markers.
 *
 * TIME LIMIT (review R7): OVERLAY_TIME_LIMIT_MS of STARTED time; it pauses at
 * onStop and resumes at onStart. The JS 12 s force-reveal is unchanged.
 *
 * NAVIGATION BAR (review R8 + R9): while the overlay shows, the navigation bar
 * gets the splash colour, no contrast scrim and light (white) icons, like the
 * system splash. The app sets its own icon appearance during boot, so R9
 * re-applies the icon appearance on every overlay frame while the overlay
 * shows. Each value is restored at removal only if it still holds what was
 * set here.
 *
 * CRASH GUARD (field "treatment" only). While a treatment process is started
 * and not yet dismissed, the guard file holds a mark (pid + time); onStop and
 * dismiss clear it. At the next process start the background thread reads the
 * guard file. A mark still there means that process died in the foreground
 * before the app was ready. On API 30+ ApplicationExitInfo decides: only
 * REASON_CRASH, REASON_CRASH_NATIVE and REASON_ANR count; with no exit record
 * (or below API 30) the mark counts. The evaluation runs AFTER this launch's
 * mode is fixed, so after MAX_FOREGROUND_DEATHS - 1 counted deaths it writes a
 * fallback marker for the NEXT launch; a dismiss in this launch deletes it
 * again. Net effect: MAX_FOREGROUND_DEATHS consecutive foreground deaths give
 * one launch in today's behaviour ("fallback"). That launch reaches JS, which
 * writes the current remote value, so a rolled-back flag always takes effect.
 * A mark whose write was still queued when the process died is lost; the
 * guard then under-counts (fail-open), it never over-counts.
 *
 * iOS is not affected. This module is Android-only.
 */
object QariahBootSplash {
  const val FLAG_FILE = "qariah_boot_nonblocking_splash.on"
  const val FALLBACK_FILE = "qariah_boot_nonblocking_splash.fallback"
  const val GUARD_FILE = "qariah_boot_nonblocking_splash.guard"
  // Lab builds only: a persisted lab arm (see resolveMode).
  const val LAB_C1B_FILE = "qariah_boot_nonblocking_splash.lab-c1b"
  const val LAB_PERSIST_FILE = "qariah_boot_nonblocking_splash.lab-persist"
  const val LAB_EXTRA = "qariah_lab_nonblocking_splash"
  const val LAB_VARIANT_EXTRA = "qariah_lab_splash_variant"
  const val LAB_PERSIST_EXTRA = "qariah_lab_persist"
  const val MAX_FOREGROUND_DEATHS = 3
  const val OVERLAY_TIME_LIMIT_MS = 30_000L
  private const val FADE_MS = 200L
  private const val TAG = "QariahBootSplash"
  private const val OVERLAY_A11Y_LABEL = "Loading"

  // Mode names. JS reads them for telemetry (a PostHog super property).
  const val MODE_CONTROL = "control"
  const val MODE_TREATMENT = "treatment"
  const val MODE_FALLBACK = "fallback"
  const val MODE_LAB_CONTROL = "lab-control"
  const val MODE_LAB_TREATMENT = "lab-treatment"
  const val MODE_LAB_TREATMENT_C1B = "lab-treatment-c1b"

  private val mainHandler = Handler(Looper.getMainLooper())

  // One background thread for all file I/O and the guard evaluation. Tasks
  // run in submit order. (The logo decode has its own thread.)
  private val io: ExecutorService by lazy {
    Executors.newSingleThreadExecutor { r ->
      Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        r.run()
      }, "qariah-boot-splash").apply { isDaemon = true }
    }
  }

  // --- process state; main thread unless noted -----------------------------
  @Volatile
  private var mode: String = MODE_CONTROL
  private var appStartChecked = false
  private var flagOnAtStart = false
  private var fallbackAtStart = false
  private var modeResolved = false
  private var dismissed = false
  private var overlayGone = false // removed by dismiss or by the time limit
  // Overlay time limit counts STARTED time only (review R7): paused at onStop.
  private var timeLimitRemainingMs = OVERLAY_TIME_LIMIT_MS
  private var timeLimitStartedAt = -1L // uptimeMillis while running, else -1
  // Navigation bar state saved while the overlay shows (review R8).
  private var navWindowRef: WeakReference<Window>? = null
  private var navApplied = false
  private var savedNavColor = 0
  private var appliedNavColor = 0
  private var savedNavContrast = true
  private var savedLightNavIcons = false
  private var navIconsReapplied = 0
  private var lifecycleCallbacks: Application.ActivityLifecycleCallbacks? = null
  private var mainActivityClass: String? = null
  private var appContext: Context? = null
  private var overlayRef: WeakReference<View>? = null
  private var contentRef: WeakReference<View>? = null
  private var contentA11yBefore = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO

  // Early logo decode (written by the early thread, read on main).
  @Volatile private var earlyStarted = false
  @Volatile private var earlyStartedAt = 0L
  @Volatile private var earlyDrawable: Drawable? = null
  @Volatile private var earlyNight = false
  @Volatile private var earlyMs = -1L

  // Guard state, io thread only.
  private var guardDeaths = 0

  /** The mode this process uses. "control" until MainActivity resolves it. */
  fun getMode(): String = mode

  private fun isTreatment() =
    mode == MODE_TREATMENT || mode == MODE_LAB_TREATMENT || mode == MODE_LAB_TREATMENT_C1B

  private fun dir(context: Context): File = context.applicationContext.noBackupFilesDir

  /**
   * Application.onCreate (QariahBootSplashPackage). Main thread: one stat()
   * for the flag marker, one more for the fallback marker when the flag is on.
   * Everything else goes to the background thread.
   */
  fun onApplicationCreate(application: Application) {
    try {
      appContext = application
      checkMarkers(application)
      // Flag off (every control user): nothing more, not even the io thread.
      // Guard state from an earlier "on" period was deleted when JS turned the
      // flag off (setEnabledForNextLaunch).
      if (flagOnAtStart) {
        io.execute { evaluateGuard(application) }
        if (!fallbackAtStart) startEarlyLogoDecode(application)
      }
    } catch (t: Throwable) {
      Log.w(TAG, "boot splash app-start check failed; today's behaviour", t)
    }
  }

  private fun checkMarkers(context: Context) {
    if (appStartChecked) return
    appStartChecked = true
    val d = dir(context)
    flagOnAtStart = File(d, FLAG_FILE).exists()
    fallbackAtStart = flagOnAtStart && File(d, FALLBACK_FILE).exists()
  }

  /**
   * Call from MainActivity.onCreate, AFTER super.onCreate(). Returns true when
   * the caller must call SplashScreenManager.hide() now (treatment). Never
   * throws: any failure returns false, which is today's behaviour.
   */
  fun onActivityCreated(activity: Activity, allowLabOverride: Boolean): Boolean {
    return try {
      appContext = activity.applicationContext
      if (!modeResolved) {
        mode = resolveMode(activity, allowLabOverride)
        modeResolved = true
        // One line per process. The lab A/B reads it to confirm the arm.
        Log.i(TAG, "boot splash mode=$mode")
      }
      if (!isTreatment()) return false
      // JS already revealed the app in this process (an Activity re-create
      // with a warm JS context), or the time limit removed the overlay.
      if (!dismissed && !overlayGone) {
        mainActivityClass = activity.javaClass.name
        registerLifecycle(activity)
        setForegroundMark(true)
        addOverlay(activity)
        resumeTimeLimit()
      }
      true
    } catch (t: Throwable) {
      Log.w(TAG, "boot splash setup failed; today's behaviour", t)
      false
    }
  }

  /** JS: the app is ready. Fades the overlay out. Safe from any thread. */
  fun dismiss(context: Context?) {
    mainHandler.post {
      try {
        if (!dismissed) {
          dismissed = true
          // One line per process: the app-ready moment in BOTH arms (JS calls
          // dismiss wherever it hides the splash). The lab A/B reads it.
          Log.i(TAG, "boot splash dismissed mode=$mode")
          val ctx = (context ?: appContext)?.applicationContext
          if ((mode == MODE_TREATMENT || mode == MODE_FALLBACK) && ctx != null) {
            io.execute {
              guardDeaths = 0
              writeGuard(ctx, 0, 0L)
              deleteQuietly(File(dir(ctx), FALLBACK_FILE))
            }
          }
          unregisterLifecycle()
        }
        removeOverlay()
      } catch (_: Throwable) {
        // A dismiss must never throw into the app.
      }
    }
  }

  /**
   * JS: store the remote flag value for the NEXT launch (background thread).
   * A changed value also clears the crash-guard state, so an owner who turns
   * the flag off and on again gets a fresh start.
   */
  fun setEnabledForNextLaunch(context: Context?, enabled: Boolean) {
    val ctx = (context ?: appContext)?.applicationContext ?: return
    io.execute {
      try {
        // A lab build that persisted an arm keeps it; the remote flag must not
        // overwrite a lab experiment (lab builds only create this file).
        if (File(dir(ctx), LAB_PERSIST_FILE).exists()) return@execute
        val flag = File(dir(ctx), FLAG_FILE)
        if (flag.exists() == enabled) return@execute
        if (enabled) flag.createNewFile() else deleteQuietly(flag)
        guardDeaths = 0
        deleteQuietly(File(dir(ctx), GUARD_FILE))
        deleteQuietly(File(dir(ctx), FALLBACK_FILE))
      } catch (_: Throwable) {
        // Fail closed: the stored value stays as it was.
      }
    }
  }

  private fun resolveMode(activity: Activity, allowLabOverride: Boolean): String {
    val intent = activity.intent
    if (allowLabOverride && intent != null && intent.hasExtra(LAB_EXTRA)) {
      val variant = intent.getStringExtra(LAB_VARIANT_EXTRA)
      val treatment = intent.getBooleanExtra(LAB_EXTRA, false)
      val c1b = treatment && variant == "c1b"
      // Lab persist-arm: with `--ez qariah_lab_persist true` the extra also
      // writes the markers, so a later REAL launcher tap (no extra) uses the
      // same arm. Opt-in, so the interleaved A/B runs (extra only) do not flip
      // the markers between arms: a persisted "on" marker would start the early
      // logo decode in Application.onCreate of the next CONTROL run. Variant
      // "clear" removes the lab markers and hands the flag back to JS/PostHog.
      val clear = variant == "clear"
      if (clear || intent.getBooleanExtra(LAB_PERSIST_EXTRA, false)) {
        persistLabArm(activity, treatment, c1b, clear)
      }
      if (!treatment) return MODE_LAB_CONTROL
      return if (c1b) MODE_LAB_TREATMENT_C1B else MODE_LAB_TREATMENT
    }
    // Normally done in Application.onCreate; this covers a missed listener.
    checkMarkers(activity)
    if (!flagOnAtStart) return MODE_CONTROL
    if (allowLabOverride && File(dir(activity), LAB_C1B_FILE).exists()) {
      return MODE_LAB_TREATMENT_C1B // persisted lab C1b arm (lab builds only)
    }
    if (fallbackAtStart) {
      Log.w(TAG, "boot splash fallback after $MAX_FOREGROUND_DEATHS foreground deaths")
      return MODE_FALLBACK
    }
    return MODE_TREATMENT
  }

  /** Lab builds only. Writes (or clears) the markers for a persisted arm. */
  private fun persistLabArm(context: Context, treatment: Boolean, c1b: Boolean, clear: Boolean) {
    val ctx = context.applicationContext
    io.execute {
      try {
        val d = dir(ctx)
        val flag = File(d, FLAG_FILE)
        val c1bFile = File(d, LAB_C1B_FILE)
        val persist = File(d, LAB_PERSIST_FILE)
        if (clear) {
          deleteQuietly(flag); deleteQuietly(c1bFile); deleteQuietly(persist)
        } else {
          if (treatment) flag.createNewFile() else deleteQuietly(flag)
          if (c1b) c1bFile.createNewFile() else deleteQuietly(c1bFile)
          persist.createNewFile()
        }
        guardDeaths = 0
        deleteQuietly(File(d, GUARD_FILE))
        deleteQuietly(File(d, FALLBACK_FILE))
      } catch (_: Throwable) {
      }
    }
  }

  // --- crash guard (io thread) ------------------------------------------------

  private fun evaluateGuard(context: Context) {
    try {
      val g = readGuard(context)
      guardDeaths = g.third
      if (g.first != 0 && diedBadly(context, g.first, g.second)) guardDeaths += 1
      writeGuard(context, 0, 0L)
      if (guardDeaths >= MAX_FOREGROUND_DEATHS - 1) {
        // This launch's mode is already fixed. If this launch also dies before
        // it is ready, the next one falls back. A dismiss deletes the marker.
        File(dir(context), FALLBACK_FILE).createNewFile()
      }
      if (fallbackAtStart) {
        guardDeaths = 0
        writeGuard(context, 0, 0L)
        deleteQuietly(File(dir(context), FALLBACK_FILE))
      }
    } catch (_: Throwable) {
      // Guard is best-effort; never throws into the app.
    }
  }

  /** (pid, time, deaths); zeros when the file is missing or unreadable. */
  private fun readGuard(context: Context): Triple<Int, Long, Int> =
    try {
      val parts = File(dir(context), GUARD_FILE).readText().trim().split(" ")
      Triple(parts[0].toInt(), parts[1].toLong(), parts[2].toInt())
    } catch (_: Throwable) {
      Triple(0, 0L, 0)
    }

  /** temp file + rename, no fsync. */
  private fun writeGuard(context: Context, pid: Int, time: Long) {
    try {
      val d = dir(context)
      val tmp = File(d, "$GUARD_FILE.tmp")
      tmp.writeText("$pid $time $guardDeaths")
      if (!tmp.renameTo(File(d, GUARD_FILE))) deleteQuietly(tmp)
    } catch (_: Throwable) {
    }
  }

  private fun deleteQuietly(f: File) {
    try {
      if (f.exists()) f.delete()
    } catch (_: Throwable) {
    }
  }

  /**
   * True when the marked process died in a way the guard must count. On API
   * 30+ an exit record for that pid decides; a user or system kill does not
   * count. With no record the foreground mark itself counts.
   */
  private fun diedBadly(context: Context, pid: Int, markTime: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true
    return try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return true
      val record = am.getHistoricalProcessExitReasons(context.packageName, pid, 1)
        .firstOrNull { it.timestamp >= markTime }
        ?: return true
      when (record.reason) {
        ApplicationExitInfo.REASON_CRASH,
        ApplicationExitInfo.REASON_CRASH_NATIVE,
        ApplicationExitInfo.REASON_ANR -> true
        else -> false
      }
    } catch (_: Throwable) {
      true
    }
  }

  /** The crash-guard mark. Field "treatment" only; lab runs never touch it. */
  private fun setForegroundMark(on: Boolean) {
    if (mode != MODE_TREATMENT || dismissed) return
    val ctx = appContext ?: return
    val pid = if (on) Process.myPid() else 0
    val time = if (on) System.currentTimeMillis() else 0L
    io.execute { writeGuard(ctx, pid, time) }
  }

  private fun registerLifecycle(activity: Activity) {
    if (lifecycleCallbacks != null) return
    val cb = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(a: Activity) {
        if (a.javaClass.name != mainActivityClass) return
        setForegroundMark(true)
        resumeTimeLimit()
      }
      override fun onActivityStopped(a: Activity) {
        if (a.javaClass.name != mainActivityClass) return
        // A stop before dismiss is a user or system move to the background,
        // not a crash: clear the mark (queued; no main-thread wait).
        setForegroundMark(false)
        // The boot runs slowly in the background; do not let that time use
        // up the overlay limit (it removed the overlay before app-ready on
        // the Pixel 3 after BACK + relaunch).
        pauseTimeLimit()
      }
      override fun onActivityCreated(a: Activity, b: Bundle?) {}
      override fun onActivityResumed(a: Activity) {}
      override fun onActivityPaused(a: Activity) {}
      override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
      override fun onActivityDestroyed(a: Activity) {}
    }
    activity.application.registerActivityLifecycleCallbacks(cb)
    lifecycleCallbacks = cb
  }

  private fun unregisterLifecycle() {
    val cb = lifecycleCallbacks ?: return
    (appContext as? Application)?.unregisterActivityLifecycleCallbacks(cb)
    lifecycleCallbacks = null
  }

  private val timeLimitRunnable = Runnable {
    timeLimitStartedAt = -1L
    if (!dismissed && !overlayGone) {
      Log.w(TAG, "boot splash overlay time limit ${OVERLAY_TIME_LIMIT_MS} ms of started time reached; removed")
      removeOverlay()
      // The overlay is gone, so this process no longer tracks foreground
      // deaths. Clear the mark and stop the lifecycle callbacks. Without this,
      // `dismissed` stays false when JS never hides the splash, and every
      // later start/stop keeps writing the mark. A crash hours later would
      // then count as a boot-splash death: an over-count, which the guard
      // must never do (under-count is the accepted residue).
      setForegroundMark(false)
      unregisterLifecycle()
    }
  }

  /** Main thread. Idempotent. Runs the limit while the activity is started. */
  private fun resumeTimeLimit() {
    if (dismissed || overlayGone || timeLimitStartedAt >= 0) return
    timeLimitStartedAt = SystemClock.uptimeMillis()
    mainHandler.postDelayed(timeLimitRunnable, timeLimitRemainingMs.coerceAtLeast(0L))
  }

  /** Main thread. Keeps the unused part of the limit for the next start. */
  private fun pauseTimeLimit() {
    if (timeLimitStartedAt < 0) return
    mainHandler.removeCallbacks(timeLimitRunnable)
    timeLimitRemainingMs -= SystemClock.uptimeMillis() - timeLimitStartedAt
    timeLimitStartedAt = -1L
  }

  // --- logo (early thread, main fallback) --------------------------------------

  private fun isNight(context: Context): Boolean =
    (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  /** Application.onCreate: decode the logo on its own DEFAULT-priority thread. */
  private fun startEarlyLogoDecode(application: Application) {
    if (earlyStarted) return
    earlyStarted = true
    earlyStartedAt = SystemClock.elapsedRealtime()
    Thread({
      try {
        val res = application.resources
        val id = res.getIdentifier("splashscreen_logo", "drawable", application.packageName)
        if (id != 0) {
          val t0 = SystemClock.elapsedRealtime()
          val night = isNight(application)
          val drawable = res.getDrawable(id, null)
          earlyNight = night
          earlyMs = SystemClock.elapsedRealtime() - t0
          earlyDrawable = drawable // published last: non-null means complete
        }
      } catch (_: Throwable) {
        // The overlay falls back to a main-thread decode.
      }
    }, "qariah-boot-splash-logo").apply {
      priority = Thread.NORM_PRIORITY // DEFAULT, not background
      isDaemon = true
      start()
    }
  }

  /**
   * Main thread, from addOverlay. The early result if it is complete and for
   * the same day/night mode; otherwise a synchronous decode here (the early
   * result is then discarded). Logs the source once per launch.
   */
  private fun overlayLogo(activity: Activity, logoId: Int): Drawable? {
    val early = earlyDrawable
    if (early != null && earlyNight == isNight(activity)) {
      Log.i(TAG, "boot splash logo source=early decode_ms=$earlyMs")
      return early
    }
    val soFar = if (earlyStarted) SystemClock.elapsedRealtime() - earlyStartedAt else -1L
    val t0 = SystemClock.elapsedRealtime()
    val drawable = try {
      activity.resources.getDrawable(logoId, activity.theme)
    } catch (_: Throwable) {
      null
    }
    earlyDrawable = null // discard a late early result
    Log.i(
      TAG,
      "boot splash logo source=main main_decode_ms=${SystemClock.elapsedRealtime() - t0} " +
        "early_started=$earlyStarted early_ms_so_far=$soFar" +
        (if (early != null) " early_night_mismatch=true" else "")
    )
    return drawable
  }

  // --- overlay (main thread) ---------------------------------------------------

  /** Fades out and removes the overlay; restores the content view. */
  private fun removeOverlay() {
    overlayGone = true
    mainHandler.removeCallbacks(timeLimitRunnable)
    timeLimitStartedAt = -1L
    restoreNavigationBar()
    contentRef?.get()?.let { content ->
      content.importantForAccessibility = contentA11yBefore
      if (content.visibility == View.INVISIBLE) content.visibility = View.VISIBLE
    }
    contentRef = null
    val view = overlayRef?.get() ?: return
    overlayRef = null
    view.isClickable = false
    view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    view.animate()
      .alpha(0f)
      .setDuration(FADE_MS)
      .withEndAction { (view.parent as? ViewGroup)?.removeView(view) }
      .start()
  }

  private fun addOverlay(activity: Activity) {
    val decor = activity.window?.decorView as? ViewGroup ?: return
    overlayRef?.get()?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }

    val res = activity.resources
    val bgId = res.getIdentifier("splashscreen_background", "color", activity.packageName)
    val density = res.displayMetrics.density

    val splashColor = if (bgId != 0) activity.getColor(bgId) else null
    val overlay = FrameLayout(activity).apply {
      if (splashColor != null) setBackgroundColor(splashColor)
      // Consume touches so nothing under the overlay reacts. Not focusable, so
      // key events still reach the Activity.
      isClickable = true
      isFocusable = false
      contentDescription = OVERLAY_A11Y_LABEL
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    val maskPx = (192 * density).toInt()
    val iconPx = (288 * density).toInt()
    val mask = FrameLayout(activity).apply {
      clipChildren = true
      clipToOutline = true
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) {
          outline.setOval(0, 0, view.width, view.height)
        }
      }
    }
    val icon = ImageView(activity).apply {
      scaleType = ImageView.ScaleType.FIT_XY
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    val logoId = res.getIdentifier("splashscreen_logo", "drawable", activity.packageName)
    if (logoId != 0) overlayLogo(activity, logoId)?.let { icon.setImageDrawable(it) }
    mask.addView(icon, FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER))
    overlay.addView(mask, FrameLayout.LayoutParams(maskPx, maskPx, Gravity.CENTER))

    // Hide the app content from accessibility services while the overlay
    // shows, so TalkBack reads "Loading" and not a half-built screen. In the
    // lab C1b arm the content also does not draw until dismiss.
    activity.findViewById<View>(android.R.id.content)?.let { content ->
      contentA11yBefore = content.importantForAccessibility
      content.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      if (mode == MODE_LAB_TREATMENT_C1B) content.visibility = View.INVISIBLE
      contentRef = WeakReference(content)
    }

    decor.addView(
      overlay,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    overlayRef = WeakReference(overlay)
    if (splashColor != null) {
      applyNavigationBar(activity, splashColor)
      // R9: hold the icon appearance for as long as the overlay draws.
      overlay.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (!navApplied || overlayRef?.get() !== overlay) {
            overlay.viewTreeObserver.removeOnPreDrawListener(this)
            return true
          }
          enforceNavIcons()
          return true
        }
      })
    }
  }

  // --- navigation bar while the overlay shows (review R8) ----------------------

  /**
   * With button navigation the app window shows its navigation-bar contrast
   * scrim (and dark icons) over the overlay, a visible strip the system splash
   * does not have. While the overlay shows: splash colour, no contrast scrim,
   * light (white) icons like the system splash. Each saved value is restored
   * at removal ONLY if it still holds the value set here, so a colour or
   * appearance JS set during boot (NavigationBar.setBackgroundColorAsync) is
   * kept. On targetSdk 35+ edge-to-edge the colour is ignored by the system,
   * but the scrim switch still applies and the overlay itself draws under the
   * bar.
   */
  @Suppress("DEPRECATION")
  private fun applyNavigationBar(activity: Activity, splashColor: Int) {
    navIconsReapplied = 0
    try {
      val w = activity.window ?: return
      savedNavColor = w.navigationBarColor
      appliedNavColor = splashColor
      w.navigationBarColor = splashColor
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        savedNavContrast = w.isNavigationBarContrastEnforced
        w.isNavigationBarContrastEnforced = false
      }
      savedLightNavIcons = isLightNavIcons(w)
      if (savedLightNavIcons) setLightNavIcons(w, false)
      navWindowRef = WeakReference(w)
      navApplied = true
    } catch (_: Throwable) {
    }
  }

  @Suppress("DEPRECATION")
  private fun restoreNavigationBar() {
    if (!navApplied) return
    navApplied = false
    try {
      val w = navWindowRef?.get() ?: return
      if (w.navigationBarColor == appliedNavColor) w.navigationBarColor = savedNavColor
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !w.isNavigationBarContrastEnforced) {
        w.isNavigationBarContrastEnforced = savedNavContrast
      }
      if (savedLightNavIcons && !isLightNavIcons(w)) setLightNavIcons(w, true)
      if (navIconsReapplied > 0) {
        Log.i(TAG, "boot splash nav icons re-applied $navIconsReapplied times while the overlay showed")
      }
    } catch (_: Throwable) {
    }
    navWindowRef = null
  }

  /**
   * R9. The app sets light (dark-icon) navigation bars during boot, which the
   * single set in applyNavigationBar cannot hold. Called on every overlay
   * frame while the overlay shows: cheap (one appearance read), and it stops
   * as soon as the overlay goes.
   */
  private fun enforceNavIcons() {
    if (!navApplied) return
    try {
      val w = navWindowRef?.get() ?: return
      if (isLightNavIcons(w)) {
        setLightNavIcons(w, false)
        navIconsReapplied += 1
      }
    } catch (_: Throwable) {
    }
  }

  @Suppress("DEPRECATION")
  private fun isLightNavIcons(w: Window): Boolean = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
      ((w.insetsController?.systemBarsAppearance ?: 0) and
        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS) != 0
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ->
      (w.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) != 0
    else -> false
  }

  @Suppress("DEPRECATION")
  private fun setLightNavIcons(w: Window, light: Boolean) {
    when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
        w.insetsController?.setSystemBarsAppearance(
          if (light) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0,
          WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> {
        val v = w.decorView
        v.systemUiVisibility = if (light) {
          v.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        } else {
          v.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
        }
      }
    }
  }
}
