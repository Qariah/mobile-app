import ExpoModulesCore

// Qariah S35.2 — iOS no-op stub. The probe targets the Android media3/Glide
// Java-heap OOM (vc1255); iOS has a different memory model (jetsam). Kept API-
// compatible so the JS surface is identical cross-platform — getHeapStats returns
// an empty map and the module emits no events on iOS.
public class QariahMemoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QariahMemory")

    Events("onMemoryPressure")

    Function("setEnabled") { (_: Bool) in
      // no-op on iOS
    }

    Function("getHeapStats") { () -> [String: Any] in
      return [:]
    }
  }
}
