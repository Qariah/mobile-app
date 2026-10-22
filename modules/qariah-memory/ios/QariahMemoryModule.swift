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

// @ai Qariah Sprint 47 (Tier-2 Arabic fix) — QariahAppLanguage: the iOS
// per-app language (the app's `AppleLanguages` user default), which
// i18n/qariahIosLanguage.ts keeps in step with the in-app language choice.
// UIKit takes "natural" text alignment from it, so without it Arabic text was
// aligned left on an English device. JS cannot remove a user default (React
// Native's `Settings` drops null values), and "System default" must remove
// the value, so this one call is native.
//
// It lives in this pod only so that it needs no new pod (no `pod install`, no
// Podfile.lock change): a pod may hold more than one Expo module, and
// expo-module.config.json registers it. Move it to its own module at the next
// native change that runs `pod install` anyway.
public class QariahAppLanguageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QariahAppLanguage")

    // A language code writes [code]; null removes the app's own value, so the
    // device language list applies again. UIKit reads it at the next launch.
    Function("setPreferredLanguage") { (code: String?) in
      let defaults = UserDefaults.standard
      if let code = code, !code.isEmpty {
        defaults.set([code], forKey: "AppleLanguages")
      } else {
        defaults.removeObject(forKey: "AppleLanguages")
      }
    }

    // The device's own language list (the global domain), which the app's
    // value hides while it is set. "System default" resolves the language
    // from this list, not from the app's own value (Sprint 47 review).
    Function("getSystemLanguages") { () -> [String] in
      let global = UserDefaults.standard.persistentDomain(
        forName: UserDefaults.globalDomain)
      return (global?["AppleLanguages"] as? [String]) ?? []
    }
  }
}
