package expo.modules.qariahmountpump

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method

/**
 * Qariah (ANR floor work, class B): the mount pump. Android only.
 *
 * THE PROBLEM. When the activity pauses, React Native stops the frame callback
 * that applies UI changes (FabricUIManager.onHostPause). JS keeps running (the
 * audio plays), and each UI change that it sends waits in a queue. On return,
 * React Native applies the whole queue in the first frame. The window cannot
 * draw, and it has no input focus, until that frame ends. After a long listen
 * the frame took 5,965 ms on a Galaxy A10s: Android reports an ANR.
 * planning/android-anr-floor-rca-2026-11-11.md, section 3, class B.
 *
 * THE FIX. While the activity is paused, this module applies the queue about
 * once a second, on the UI thread. So the queue stays short, and the return
 * frame has only the changes of the last second. iOS has no such queue: it
 * applies each change at once, also in the background.
 *
 * HOW. React Native has no public call that applies the queue. But it applies
 * the queue itself, outside a frame, when a commit comes from the UI thread
 * (FabricUIManager.scheduleMountItem: a GuardedRunnable that calls
 * MountItemDispatcher.tryDispatchMountItems()). This module calls the same
 * function. It reads the dispatcher from the private field
 * FabricUIManager.mMountItemDispatcher by reflection.
 *
 * FAILS SAFE. If the field or the function is not there (a React Native
 * upgrade), the state is "unavailable" and the app behaves as before. An
 * exception from a mount item goes to ReactContext.handleException, the same
 * path as an exception in a normal frame. The pump does no work when the queue
 * is empty: a UIManagerListener starts it only when React Native queues a
 * change while the activity is paused.
 *
 * THE RETURN-FRAME REPORT. At each host resume the module measures the time
 * from the resume to the end of the first frame. When it is RETURN_REPORT_MS
 * or more (and not above RETURN_REPORT_MAX_MS: such a frame waited for the
 * display), JS gets the event `onReturnFrame` (telemetry only). It works with
 * the pump on and off, so the field can compare them.
 *
 * KNOWN LIMIT. The listener fires for a commit (scheduleMountItem). A view
 * command or a state update that JS sends with no commit waits in the queue
 * until the next commit or the resume. TECH_DEBT #412.
 *
 * The release build has no code shrinker (android.enableMinifyInReleaseBuilds
 * is false), so the names are stable. If the shrinker is turned on, keep
 * FabricUIManager.mMountItemDispatcher and MountItemDispatcher.
 *
 * UIManagerListener is an unstable React Native API (the opt-in below): an
 * upgrade can change it, and then this file does not compile. That is the
 * right time to read this file again.
 */
@OptIn(UnstableReactNativeAPI::class)
class QariahMountPumpModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  // The JS switch (the build flag and the remote off switch). Off until JS says on.
  @Volatile private var enabled = false

  // True between host pause and host resume. Main thread writes.
  @Volatile private var paused = false

  // "off" | "on" | "unavailable". JS reads it for telemetry.
  @Volatile private var state = STATE_OFF

  @Volatile private var flushQueued = false

  // Main thread only.
  private var boundUiManager: UIManager? = null
  private var dispatcher: Any? = null
  private var tryDispatch: Method? = null
  private var flushes = 0
  // elapsedRealtime (it counts deep sleep), 0 when no pause is recorded.
  private var pausedAtMs = 0L

  // Any thread: React Native calls didScheduleMountItems on the thread that
  // queued the change (the JS thread or the commit thread).
  private val listener = object : UIManagerListener {
    override fun willDispatchViewUpdates(uiManager: UIManager) {}
    override fun willMountItems(uiManager: UIManager) {}
    override fun didMountItems(uiManager: UIManager) {}
    override fun didDispatchMountItems(uiManager: UIManager) {}
    override fun didScheduleMountItems(uiManager: UIManager) {
      if (enabled && paused) requestFlush()
    }
  }

  private val flush = Runnable {
    flushQueued = false
    if (enabled && paused) applyQueue()
  }

  override fun definition() = ModuleDefinition {
    Name("QariahMountPump")
    Events("onReturnFrame")

    // The JS switch. It applies at once, also while the app is in the background.
    Function("setEnabled") { on: Boolean ->
      enabled = on
      mainHandler.post {
        // Main thread only, like bind(): a late "on" must not hide "unavailable".
        if (state != STATE_UNAVAILABLE) state = if (on) STATE_ON else STATE_OFF
        if (on) {
          // Find the dispatcher now, so that getState says "unavailable"
          // soon after the start, not only after the first pause.
          bind()
          if (paused) requestFlush()
        } else {
          mainHandler.removeCallbacks(flush)
          flushQueued = false
        }
      }
    }

    // "off" | "on" | "unavailable".
    Function("getState") { state }

    // The number of times the pump applied the queue in this process (lab use).
    Function("getFlushCount") { flushes }

    // Host pause: React Native stopped its frame callback just now.
    OnActivityEntersBackground {
      paused = true
      pausedAtMs = SystemClock.elapsedRealtime()
      if (enabled) {
        bind()
        // A change that JS sent just before the pause can be in the queue.
        requestFlush()
      }
    }

    // Host resume: React Native applies the queue in its own frames again.
    OnActivityEntersForeground {
      paused = false
      mainHandler.removeCallbacks(flush)
      flushQueued = false
      reportReturnFrame()
    }

    OnDestroy {
      enabled = false
      mainHandler.removeCallbacks(flush)
      try {
        boundUiManager?.removeUIManagerEventListener(listener)
      } catch (_: Throwable) {
      }
      boundUiManager = null
      dispatcher = null
      tryDispatch = null
    }
  }

  /**
   * Main thread, at host resume. The frame callback runs at the start of the
   * first frame; the message that it posts runs when that frame ends. React
   * Native applies its queue inside that frame.
   */
  private fun reportReturnFrame() {
    val pausedAt = pausedAtMs
    pausedAtMs = 0L
    if (pausedAt == 0L) return // the first resume of the process: a cold start
    val backgroundSeconds = (SystemClock.elapsedRealtime() - pausedAt) / 1000L
    val resumedAt = SystemClock.uptimeMillis()
    val pumpState = state
    try {
      Choreographer.getInstance().postFrameCallback {
        mainHandler.post {
          val frameMs = SystemClock.uptimeMillis() - resumedAt
          // A frame that waited longer than this waited for the display (a
          // resume with the screen off), not for the app: no report.
          if (frameMs in RETURN_REPORT_MS..RETURN_REPORT_MAX_MS) {
            try {
              sendEvent(
                "onReturnFrame",
                mapOf(
                  "frameMs" to frameMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                  "backgroundSeconds" to
                    backgroundSeconds.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt(),
                  "pump" to pumpState
                )
              )
            } catch (_: Throwable) {
              // Telemetry only.
            }
          }
        }
      }
    } catch (_: Throwable) {
      // Telemetry only.
    }
  }

  private fun requestFlush() {
    // A double post from two threads is harmless: the second run finds an
    // empty queue.
    if (flushQueued) return
    flushQueued = true
    mainHandler.postDelayed(flush, FLUSH_DELAY_MS)
  }

  /**
   * Main thread. Finds the Fabric UI manager of the current React instance and
   * its mount dispatcher, and adds the listener. Runs again when the React
   * instance changed. Never throws.
   */
  private fun bind() {
    if (state == STATE_UNAVAILABLE) return
    try {
      val reactContext = appContext.reactContext as? ReactContext ?: return
      val uiManager = UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) ?: return
      if (uiManager === boundUiManager) return
      try {
        boundUiManager?.removeUIManagerEventListener(listener)
      } catch (_: Throwable) {
      }
      val field = uiManager.javaClass.getDeclaredField(DISPATCHER_FIELD)
      field.isAccessible = true
      val found = field.get(uiManager) ?: throw IllegalStateException("no dispatcher")
      val method = found.javaClass.getDeclaredMethod(DISPATCH_METHOD)
      method.isAccessible = true
      uiManager.addUIManagerEventListener(listener)
      boundUiManager = uiManager
      dispatcher = found
      tryDispatch = method
    } catch (t: Throwable) {
      // A React Native upgrade moved the field or the function. Behave as
      // before this module, and say so once.
      state = STATE_UNAVAILABLE
      boundUiManager = null
      dispatcher = null
      tryDispatch = null
      Log.w(TAG, "mount pump unavailable: ${t.javaClass.simpleName}: ${t.message}")
    }
  }

  /** Main thread. Applies the queued UI changes, as React Native does in a frame. */
  private fun applyQueue() {
    val target = dispatcher ?: return
    val method = tryDispatch ?: return
    try {
      method.invoke(target)
      flushes += 1
    } catch (e: InvocationTargetException) {
      // A mount item threw. Give it to React Native, as a normal frame does.
      val cause = e.targetException
      val reactContext = appContext.reactContext as? ReactContext
      if (reactContext != null) {
        reactContext.handleException(if (cause is Exception) cause else RuntimeException(cause))
      } else {
        throw RuntimeException(cause)
      }
    } catch (t: Throwable) {
      // The call itself failed (not a mount item). Stop for this process, so
      // that the next flush does not try again each second.
      state = STATE_UNAVAILABLE
      dispatcher = null
      tryDispatch = null
      Log.w(TAG, "mount pump stopped: ${t.javaClass.simpleName}: ${t.message}")
    }
  }

  companion object {
    private const val TAG = "QariahMountPump"
    private const val FLUSH_DELAY_MS = 1000L
    private const val RETURN_REPORT_MS = 700L
    private const val RETURN_REPORT_MAX_MS = 30_000L
    private const val DISPATCHER_FIELD = "mMountItemDispatcher"
    private const val DISPATCH_METHOD = "tryDispatchMountItems"
    private const val STATE_OFF = "off"
    private const val STATE_ON = "on"
    private const val STATE_UNAVAILABLE = "unavailable"
  }
}
