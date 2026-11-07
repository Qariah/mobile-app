import ObjectiveC
import UIKit

/// Starts React Native exactly once, into a host window that either the phone
/// scene adopts or that stays offscreen while only CarPlay is connected.
@objc public final class BayaanCarSceneBridge: NSObject {
  @objc public static let shared = BayaanCarSceneBridge()

  private var start: ((UIWindow, [UIApplication.LaunchOptionsKey: Any]) -> Void)?
  private var onWindow: ((UIWindow) -> Void)?
  public private(set) var hostWindow: UIWindow?
  private var layoutTimer: Timer?

  public func configure(
    start: @escaping (UIWindow, [UIApplication.LaunchOptionsKey: Any]) -> Void,
    onWindow: @escaping (UIWindow) -> Void
  ) {
    self.start = start
    self.onWindow = onWindow
    observeWidgetCommands() // @ai Qariah: TECH_DEBT #374
  }

  // @ai-start Qariah (TECH_DEBT #374): a widget play button after the app was stopped.
  /// The widget, Live Activity and control play buttons are AudioPlaybackIntents.
  /// They run in the app process and only queue a command for JS
  /// (WidgetCommandQueue in targets/widgets/_shared), which posts this
  /// notification in the same process. When the app is not running, iOS
  /// launches it in the background with no scene, so neither scene delegate
  /// starts React and the command expires unread. Start React offscreen, as a
  /// background Siri launch does (BayaanCarSiri.handle), and keep the process
  /// awake while JS boots and starts the audio.
  private static let widgetCommandQueued = Notification.Name("BayaanWidgetCommandQueued")
  private static let intentLaunchSeconds: TimeInterval = 25
  private var widgetCommandObserver: NSObjectProtocol?
  private var intentLaunchTask = UIBackgroundTaskIdentifier.invalid

  private func observeWidgetCommands() {
    guard widgetCommandObserver == nil else { return }
    widgetCommandObserver = NotificationCenter.default.addObserver(
      forName: Self.widgetCommandQueued, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self, self.hostWindow == nil else { return }
      self.holdBackgroundTime(seconds: Self.intentLaunchSeconds)
      self.ensureStarted()
    }
  }

  /// Background time for the JS boot. Once the audio plays, the audio
  /// background mode keeps the app running; if it never plays, iOS suspends
  /// the app when this ends. Main thread only.
  private func holdBackgroundTime(seconds: TimeInterval) {
    guard intentLaunchTask == .invalid else { return }
    intentLaunchTask = UIApplication.shared.beginBackgroundTask(withName: "BayaanWidgetCommand") {
      [weak self] in self?.endBackgroundTime()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
      self?.endBackgroundTime()
    }
  }

  private func endBackgroundTime() {
    guard intentLaunchTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(intentLaunchTask)
    intentLaunchTask = .invalid
  }
  // @ai-end

  @discardableResult
  public func ensureStarted(
    extraLaunchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
  ) -> UIWindow {
    if let window = hostWindow { return window }
    ReactTimingGuard.install()
    let window = UIWindow(frame: UIScreen.main.bounds)
    hostWindow = window
    onWindow?(window)
    start?(window, extraLaunchOptions)
    startOffscreenLayout(window)
    return window
  }

  /// UIKit never lays out a window that has no scene, and React Native's safe
  /// area provider renders nothing until a layout pass reports insets. Without
  /// this, a CarPlay-first launch (phone locked, app not running) evaluates JS
  /// but never mounts the React tree, so there is no player and no car bridge.
  /// Lay the host window out ourselves until a phone scene adopts it.
  private func startOffscreenLayout(_ window: UIWindow) {
    guard window.windowScene == nil else { return }
    layoutTimer?.invalidate()
    layoutTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self, weak window] timer in
      guard let window, window.windowScene == nil else {
        timer.invalidate()
        self?.layoutTimer = nil
        return
      }
      window.layoutIfNeeded()
    }
  }
}

/// React Native fires JS timers from a display link on the phone screen and
/// only switches `RCTTiming` to an `NSTimer` when the app goes to the
/// background. With CarPlay in the foreground the app stays active even
/// while the phone is locked, so the display link never fires and every
/// `setTimeout` stalls (the player's load wait never returns and car taps
/// never play). Keep `RCTTiming` in background mode whenever no phone scene
/// is foreground active.
enum ReactTimingGuard {
  private static weak var timing: NSObject?
  private static var installed = false
  private static let foregroundSelector = NSSelectorFromString("appDidMoveToForeground")
  private static let backgroundSelector = NSSelectorFromString("appDidMoveToBackground")

  static func install() {
    guard !installed, let cls = NSClassFromString("RCTTiming") else { return }
    installed = true
    guard
      let setup = class_getInstanceMethod(cls, NSSelectorFromString("setup")),
      let foreground = class_getInstanceMethod(cls, foregroundSelector)
    else { return }

    typealias VoidMethod = @convention(c) (AnyObject, Selector) -> Void
    let setupSelector = NSSelectorFromString("setup")
    let originalSetup = unsafeBitCast(method_getImplementation(setup), to: VoidMethod.self)
    let setupBlock: @convention(block) (AnyObject) -> Void = { object in
      originalSetup(object, setupSelector)
      DispatchQueue.main.async {
        timing = object as? NSObject
        apply()
      }
    }
    method_setImplementation(setup, imp_implementationWithBlock(setupBlock))

    let originalForeground = unsafeBitCast(method_getImplementation(foreground), to: VoidMethod.self)
    let foregroundBlock: @convention(block) (AnyObject) -> Void = { object in
      if phoneSceneActive() {
        originalForeground(object, foregroundSelector)
      } else {
        _ = (object as? NSObject)?.perform(backgroundSelector)
      }
    }
    method_setImplementation(foreground, imp_implementationWithBlock(foregroundBlock))

    let center = NotificationCenter.default
    for name in [
      UIScene.didActivateNotification,
      UIScene.willDeactivateNotification,
      UIScene.didEnterBackgroundNotification,
    ] {
      center.addObserver(forName: name, object: nil, queue: .main) { note in
        guard note.object is UIWindowScene else { return }
        apply()
      }
    }
  }

  private static func phoneSceneActive() -> Bool {
    UIApplication.shared.connectedScenes.contains { scene in
      scene is UIWindowScene && scene.activationState == .foregroundActive
    }
  }

  private static func apply() {
    guard let timing else { return }
    _ = timing.perform(phoneSceneActive() ? foregroundSelector : backgroundSelector)
  }
}
