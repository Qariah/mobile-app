import ExpoModulesCore

// iOS: intentional NO-OP. The main-thread freeze watchdog ships Android-only for
// now (the freeze-after-playback class we're chasing is Android/runBlocking). The
// module still declares the same surface so the cross-platform JS barrel can call
// setEnabled / attach the listener without a platform branch — it simply never
// activates or emits on iOS.
public class QariahAnrWatchdogModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QariahAnrWatchdog")
    Events("onMainThreadStall")
    Function("setEnabled") { (_: Bool, _: Int, _: Int) in
      // no-op on iOS
    }
  }
}
