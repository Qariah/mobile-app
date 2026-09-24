package expo.modules.qariahbootsplash

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

    // The mode this process uses: control | treatment | fallback |
    // lab-control | lab-treatment | lab-treatment-c1b.
    Function("getMode") {
      QariahBootSplash.getMode()
    }
  }
}
