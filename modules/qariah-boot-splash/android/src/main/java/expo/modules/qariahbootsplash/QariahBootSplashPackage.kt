package expo.modules.qariahbootsplash

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

// @ai Qariah (ANR WS-C, review R5/R6). Runs QariahBootSplash.onApplicationCreate
// at Application.onCreate (through Expo's ApplicationLifecycleDispatcher in
// MainApplication), before any activity exists. It stats the flag marker
// files on the main thread (no SharedPreferences), starts the crash-guard
// evaluation on a background thread, and starts the logo decode on a
// background thread when the non-blocking splash is on. With the flag marker
// absent it does one stat() and returns.
class QariahBootSplashPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          QariahBootSplash.onApplicationCreate(application)
        }
      },
    )
}
