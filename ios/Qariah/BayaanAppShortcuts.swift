// plugins/app-shortcuts/BayaanAppShortcuts.swift
// Copied into the app target by plugins/withAppShortcuts.js on every prebuild.
// App only: putting this in targets/widgets/_shared would also declare App
// Shortcuts in the widget extension.
import AppIntents
import Foundation

@available(iOS 17.0, *)
struct BayaanAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    // @ai-start
    // Qariah (owner, 2026-11-11): Spotlight shows the first shortcuts next
    // to the app, so the three that people open the app for come first.
    // "Resume" and "Continue" now run Continue listening.
    AppShortcut(
      intent: ContinueListeningShortcutIntent(),
      phrases: [
        "Continue listening in \(.applicationName)",
        "Resume \(.applicationName)",
        "Continue \(.applicationName)",
      ],
      shortTitle: "Continue listening",
      systemImageName: "headphones")
    AppShortcut(
      intent: ContinueReadingShortcutIntent(),
      phrases: [
        "Continue reading in \(.applicationName)",
        "Open the Mushaf in \(.applicationName)",
      ],
      shortTitle: "Continue reading",
      systemImageName: "book")
    AppShortcut(
      intent: SearchShortcutIntent(),
      phrases: [
        "Search \(.applicationName)",
        "Search in \(.applicationName)",
      ],
      shortTitle: "Search",
      systemImageName: "magnifyingglass")
    // @ai-end
    AppShortcut(
      intent: PlaySurahIntent(),
      phrases: [
        "Play \(\.$surah) in \(.applicationName)",
        "Play Surah \(\.$surah) in \(.applicationName)",
        "Play \(\.$surah) on \(.applicationName)",
      ],
      shortTitle: "Play Surah",
      systemImageName: "play.circle")
    AppShortcut(
      intent: PausePlaybackIntent(),
      phrases: [
        "Pause \(.applicationName)",
        "Stop \(.applicationName)",
      ],
      shortTitle: "Pause",
      systemImageName: "pause.circle")
  }
}

// @ai-start
// Qariah (owner, 2026-11-11): the three app shortcuts that open a screen
// (services/shortcuts/appShortcuts.ts). Each opens the app and queues the
// widget command {type: "openShortcut", target}; the app pushes the screen
// once its player and session are ready, also after a cold start.
// OpenURLIntent would need iOS 18, and this list supports iOS 17.

@available(iOS 17.0, *)
enum AppShortcutCommand {
  static func open(_ target: String) {
    _ = WidgetCommandQueue.enqueue(["type": "openShortcut", "target": target])
  }
}

@available(iOS 17.0, *)
struct ContinueListeningShortcutIntent: AppIntent {
  static var title: LocalizedStringResource = "Continue Listening"
  static var description = IntentDescription(
    "Opens the player and plays the recitation you listened to last.")
  static var openAppWhenRun: Bool = true

  init() {}

  func perform() async throws -> some IntentResult {
    AppShortcutCommand.open("continue-listening")
    return .result()
  }
}

@available(iOS 17.0, *)
struct ContinueReadingShortcutIntent: AppIntent {
  static var title: LocalizedStringResource = "Continue Reading"
  static var description = IntentDescription(
    "Opens the Mushaf at the page you read last.")
  static var openAppWhenRun: Bool = true

  init() {}

  func perform() async throws -> some IntentResult {
    AppShortcutCommand.open("continue-reading")
    return .result()
  }
}

@available(iOS 17.0, *)
struct SearchShortcutIntent: AppIntent {
  static var title: LocalizedStringResource = "Search"
  static var description = IntentDescription("Opens Search.")
  static var openAppWhenRun: Bool = true

  init() {}

  func perform() async throws -> some IntentResult {
    AppShortcutCommand.open("search")
    return .result()
  }
}
// @ai-end

/// The bayaan-widgets pod cannot import app-target code, so it calls this
/// through the Objective-C runtime when the module is created.
@objc(BayaanAppShortcutsRefresher)
final class BayaanAppShortcutsRefresher: NSObject {
  @objc static func refresh() {
    if #available(iOS 17.0, *) {
      BayaanAppShortcuts.updateAppShortcutParameters()
    }
  }
}
