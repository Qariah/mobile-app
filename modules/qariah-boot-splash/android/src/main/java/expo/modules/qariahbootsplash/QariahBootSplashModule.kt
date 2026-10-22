package expo.modules.qariahbootsplash

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Qariah (ANR WS-C) — JS surface of the non-blocking boot splash. See
 * QariahBootSplash.kt for the mechanism, the flag and the crash guard.
 * Every function is safe to call in any mode; in "control" the dismiss only
 * records that the app is ready.
 */
class QariahBootSplashModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QariahBootSplash")

    // Remove the native boot overlay (fade). Called where JS hides the splash.
    Function("dismiss") {
      QariahBootSplash.dismiss(appContext.reactContext ?: appContext.currentActivity)
    }

    // Store the remote PostHog flag value. It applies at the NEXT cold start.
    Function("setEnabledForNextLaunch") { enabled: Boolean ->
      QariahBootSplash.setEnabledForNextLaunch(
        appContext.reactContext ?: appContext.currentActivity,
        enabled
      )
    }

    // @ai A transient off (failed or quota-limited flag request): deletes
    // only the flag marker; the crash-guard state stays.
    Function("setOffForNextLaunchKeepGuard") {
      QariahBootSplash.setOffForNextLaunchKeepGuard(
        appContext.reactContext ?: appContext.currentActivity
      )
    }

    // The mode this process uses: control | treatment | fallback |
    // lab-control | lab-treatment | lab-treatment-c1b.
    Function("getMode") {
      QariahBootSplash.getMode()
    }

    // @ai Mark this device as a boot risk (permanent marker file).
    Function("setBootRisk") {
      QariahBootSplash.setBootRisk(appContext.reactContext ?: appContext.currentActivity)
    }

    // @ai True when the boot-risk marker is set.
    Function("getBootRisk") {
      QariahBootSplash.getBootRisk(appContext.reactContext ?: appContext.currentActivity)
    }

    // @ai The record of the previous main-activity process, or null.
    AsyncFunction("getPreviousProcessInfo") { promise: Promise ->
      QariahBootSplash.getPreviousProcessInfo(
        appContext.reactContext ?: appContext.currentActivity
      ) { info ->
        if (info == null) promise.resolve(null) else promise.resolve(info)
      }
    }
  }
}
