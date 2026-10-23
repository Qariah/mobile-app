// @ai Qariah (TECH_DEBT #289, Sprint 50): runs the one-time App Group move
// (QariahAppGroupMigration.swift) when the app launches.
//
// The order is important. The move must finish before the first MMKV
// instance opens, because react-native-mmkv opens its files in the group
// container when JavaScript calls createMMKV (i18n/language.ts does it at
// import time). Expo calls this subscriber from
// `super.application(_:didFinishLaunchingWithOptions:)` in AppDelegate.swift.
// React Native starts later: the phone or CarPlay scene starts it through
// BayaanCarSceneBridge (modules/bayaan-car), and a scene connects only after
// didFinishLaunching returns. If a change starts React Native before
// `super.application(...)`, move this call before it.
//
// A production build has no QariahLegacyAppGroup key, so this returns at once.

import ExpoModulesCore
import UIKit
import os

public class QariahAppGroupAppDelegate: ExpoAppDelegateSubscriber {
  private static let log = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "app", category: "AppGroupMigration")

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let info = Bundle.main.infoDictionary ?? [:]
    let legacy = info["QariahLegacyAppGroup"] as? String
    let current = info["AppGroupIdentifier"] as? String
    guard QariahAppGroupMigration.isConfigured(legacyGroup: legacy, currentGroup: current),
      let legacy = legacy, let current = current
    else { return true }

    let fm = FileManager.default
    let outcome = QariahAppGroupMigration.run(
      from: fm.containerURL(forSecurityApplicationGroupIdentifier: legacy),
      to: fm.containerURL(forSecurityApplicationGroupIdentifier: current),
      legacyGroup: legacy,
      fileManager: fm)
    Self.log.info("App Group move \(legacy, privacy: .public) -> \(current, privacy: .public): \(String(describing: outcome), privacy: .public)")
    return true
  }
}
