import ExpoModulesCore
import UIKit
import UIKit.UIGestureRecognizerSubclass

// @ai — RotationStage: keeps the Mushaf page coherent while iOS rotates
// the interface.
//
// WHY THIS IS NATIVE. On a rotation, UIKit animates the bounds of the window
// and of every view that the synchronous Fabric layout pass resizes, from the
// old size to the new size (the "morph", about 300 ms). The app cannot turn
// this animation off. React Native lays out the new page at once, Skia paints
// it asynchronously, and the remounted page list needs a few frames to reach
// its start page, so without help the screen shows a cropped page, a page
// beside empty space, two pages side by side, a neighbour page, or a blank
// page. Only animations in the same Core Animation timeline as the morph can
// keep the picture coherent.
//
// WHAT IT DOES. When the stage's bounds flip between portrait and landscape:
//   1. It covers itself with a snapshot of the old frame, on a backdrop of
//      the page colour.
//   2. When JS sends a mapping (the page text block in the old layout and in
//      the new layout), it animates the snapshot from the old place to the
//      new place, and the live content (the one wrapper view) from the old
//      place to its own place, with the timing of the stage's own bounds
//      animation. Both follow the morph on every frame and match each other.
//      Until the morph ends, it removes the animations that UIKit gives the
//      React views inside it for the rotation (`stripRotationAnimations`),
//      before every commit. It removes only animations with the morph's
//      duration and curve that run once; the app's own animations stay.
//   3. It removes the cover (a cut) in ONE place (`liftCoverIfReady`) when
//      the new layout is ready: JS reports that the page to show has painted,
//      the view with the `testID` that JS names sits inside the stage and is
//      opaque (the page list is at that page), and two more display frames
//      have passed. When JS asks (`waitForMorph`: the new layout shows less
//      than the snapshot, such as a phone-landscape page, which shows only
//      the top of the page in its scroller, or one portrait page after an
//      iPad spread), it also waits for the morph to end. Otherwise it lifts
//      as soon as it is ready, and the live content follows the morph.
//      A touch on the stage, or a timeout, lifts it at once. A resize with no
//      animation (a free window resize) lifts it at once: nothing moves.
//   4. A turn back to portrait waits for the new page to paint, and a phone-
//      landscape snapshot holds only the top lines of the page. So when a turn
//      leaves portrait, the stage can also keep a snapshot of the whole
//      portrait page (`portraitPicture`), and a turn back to portrait puts it
//      under the turn's snapshot, on the live content's path: the cover then
//      shows a whole page also when the paint is slow (TECH_DEBT #272). A
//      stale picture is worse than an empty area, so the rule reads the
//      output, not a list of inputs:
//      - it keeps the snapshot only when the page (`pictureTestID`) is at rest
//        and opaque inside the stage, and has not drawn in the last
//        `pictureQuietTime` (a draw that JS has reported may not be on screen
//        yet);
//      - JS reports each later draw of that page (`pageDrew`): each commit of
//        its page view or its renderer, for any reason, but for the mount and
//        the reveal, and a change of the status bar or the system text size.
//        The stage drops the snapshot at once, also from the cover of a turn
//        in progress. Only a draw with a new frame (size or safe area) while
//        a turn is in progress does not count: that is the turn itself;
//      - a turn back uses it only for the same page and size, and only after
//        the turn's mapping has placed it.

struct RotationStageMapping: Record {
  @Field var token: Int = 0
  @Field var orientation: String = ""
  @Field var fromX: Double = 0
  @Field var fromY: Double = 0
  @Field var fromWidth: Double = 0
  @Field var toX: Double = 0
  @Field var toY: Double = 0
  @Field var toWidth: Double = 0
}

/// How the stage lifts its cover once the new layout is ready.
struct RotationStageReady: Record {
  /// The view that must sit inside the stage first (the page to show).
  @Field var testID: String?
  /// Keep the cover until the morph ends: the new layout shows only part of
  /// what the snapshot shows (a phone-landscape page in its scroller).
  @Field var waitForMorph: Bool = false
}

public class RotationStageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RotationStage")

    View(RotationStageView.self) {
      Prop("mapping") { (view: RotationStageView, mapping: RotationStageMapping?) in
        view.setMapping(mapping)
      }
      Prop("backdropColor") { (view: RotationStageView, color: UIColor?) in
        view.backdropColor = color
      }
      Prop("pictureTestID") { (view: RotationStageView, testID: String?) in
        view.setPictureTestID(testID)
      }
      // A direct call, not a prop: a prop would wait for a React commit, and
      // during a turn the JS thread is busy mounting the neighbour pages.
      AsyncFunction("markReady") { (view: RotationStageView, token: Int, orientation: String, options: RotationStageReady) in
        view.markReady(token: token, orientation: orientation, options: options)
      }.runOnQueue(.main)
      AsyncFunction("pageDrew") { (view: RotationStageView, newFrame: Bool) in
        view.pageDrew(newFrame: newFrame)
      }.runOnQueue(.main)
    }
  }
}

private func orientation(of size: CGSize) -> String {
  size.width > size.height ? "landscape" : "portrait"
}

/// The animation key of the stage's own animations.
private let stageAnimationKey = "rotationStage"
/// The longest time that the cover stays when the new layout is not ready.
private let coverTimeout: TimeInterval = 1.5
/// Frames to wait once ready, so that the draw that JS reported is on screen.
private let framesAfterReady = 2
/// A page that drew less than this long ago may not show that draw yet: the
/// stage keeps no snapshot of it.
private let pictureQuietTime: CFTimeInterval = 0.5
/// The key paths of the animations that UIKit adds to views it changes.
private let uikitKeyPaths: Set<String> = [
  "position", "bounds", "bounds.size", "bounds.origin", "transform",
  "opacity", "backgroundColor", "borderColor", "borderWidth", "cornerRadius",
  "anchorPoint", "zPosition", "shadowOpacity", "shadowOffset", "shadowRadius",
]

/// The begin time, duration and curve of the stage's morph. UIKit gives
/// every animation that it adds for the rotation the same three (measured on
/// iOS 26.5 iPhone and iPad: 120-145 animations a turn, none different).
private struct MorphTiming {
  /// 0 until the transaction commits; then the commit time, as for the
  /// animations that UIKit adds with it.
  let beginTime: CFTimeInterval
  let duration: CFTimeInterval
  /// The control points of the timing function (empty when there is none).
  let curve: [Float]

  init(_ animation: CAAnimation) {
    beginTime = animation.beginTime
    duration = animation.duration
    var points: [Float] = []
    if let function = animation.timingFunction {
      for index in 1...2 {
        var point: [Float] = [0, 0]
        function.getControlPoint(at: index, values: &point)
        points += point
      }
    }
    curve = points
  }

  func matches(_ animation: CAAnimation) -> Bool {
    abs(animation.beginTime - beginTime) < 0.001
      && abs(animation.duration - duration) < 0.001
      && MorphTiming(animation).curve == curve
  }
}

private struct Turn {
  let to: CGSize
  /// When the turn started, in `CACurrentMediaTime()`.
  let start: CFTimeInterval
  /// The JS token of this turn, known once a mapping for it arrives.
  var token: Int?
  var ready = false
  var waitForMorph = false
  var morphDone = false
}

final class RotationStageView: ExpoView, UIGestureRecognizerDelegate {
  var backdropColor: UIColor?
  /// The `testID` of the painted page that the content shows, or nil.
  private var pictureTestID: String?

  /// The snapshot of the whole stage in portrait, taken when a turn left
  /// portrait, with its size and its page (see the header, step 4).
  private var portraitPicture: (view: UIView, size: CGSize, testID: String)?
  /// The portrait picture in the cover of the turn in progress. Hidden until
  /// the turn's mapping places it.
  private var turnPicture: UIView?
  /// When JS last reported a draw of the page, in `CACurrentMediaTime()`.
  private var lastPageDraw: CFTimeInterval = 0

  private var mapping: RotationStageMapping?
  private var turn: Turn?
  /// The highest JS token that a turn has used. A mapping or a report with
  /// this token or a lower one belongs to an earlier turn.
  private var usedToken = 0
  private var generation = 0
  private var cover: UIView?
  private var snapshot: UIView?
  private var readyCheck: FrameTicker?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // A touch ends the turn: the user then sees what the finger moves. The
    // recognizer never claims the touch.
    let touch = TouchBeganRecognizer(target: nil, action: nil)
    touch.onBegan = { [weak self] in self?.touchBegan() }
    touch.cancelsTouchesInView = false
    touch.delaysTouchesBegan = false
    touch.delaysTouchesEnded = false
    touch.delegate = self
    addGestureRecognizer(touch)
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    true
  }

  // MARK: - Turn detection

  // Fabric sets `center` and `bounds`; UIKit can also set `frame`. The
  // observers compare with the last size seen, so one change starts one turn.
  private var lastSize: CGSize = .zero
  // Taken in `willSet`: `snapshotView` sizes itself to the current bounds, so
  // it must run while the bounds are still the old ones. The render server
  // still shows the old frame then (during a turn back, the earlier cover).
  private var pendingSnapshot: UIView?

  override var bounds: CGRect {
    willSet { sizeWillChange(to: newValue.size) }
    didSet { sizeDidChange() }
  }

  override var frame: CGRect {
    willSet { sizeWillChange(to: newValue.size) }
    didSet { sizeDidChange() }
  }

  private func isTurn(from old: CGSize, to new: CGSize) -> Bool {
    old != new
      && old.width > 0 && old.height > 0 && new.width > 0 && new.height > 0
      && orientation(of: old) != orientation(of: new)
      && window != nil
  }

  private func sizeWillChange(to new: CGSize) {
    guard pendingSnapshot == nil, isTurn(from: bounds.size, to: new) else { return }
    pendingSnapshot = snapshotView(afterScreenUpdates: false)
    keepPortraitPicture()
  }

  /// Takes the portrait snapshot for a turn back (see the header, step 4):
  /// only of a stage with no cover, in portrait, whose page is at rest and
  /// opaque, and has not drawn in the last `pictureQuietTime`.
  private func keepPortraitPicture() {
    guard orientation(of: bounds.size) == "portrait" else { return }
    portraitPicture = nil
    guard cover == nil, let testID = pictureTestID, isShown(testID: testID),
          CACurrentMediaTime() - lastPageDraw > pictureQuietTime,
          let picture = snapshotView(afterScreenUpdates: false)
    else { return }
    portraitPicture = (picture, bounds.size, testID)
  }

  /// JS: the page drew again. Any snapshot of it may be stale now. A draw
  /// with a new frame (size or safe area) during a turn is the turn itself:
  /// its commit reaches the stage after the turn began (the mount of the
  /// same commit resized the stage). At any other time a new frame drops the
  /// snapshot too (for example the safe area of the immersive mode).
  func pageDrew(newFrame: Bool) {
    if newFrame, cover != nil { return }
    lastPageDraw = CACurrentMediaTime()
    portraitPicture = nil
    if let picture = turnPicture {
      turnPicture = nil
      UIView.performWithoutAnimation { picture.removeFromSuperview() }
    }
  }

  /// JS: the page that the content shows. Another page makes the snapshot
  /// useless: drop it (it holds about 13 MB on an iPhone, 23 MB on an iPad).
  func setPictureTestID(_ testID: String?) {
    pictureTestID = testID
    if let testID, let picture = portraitPicture, picture.testID != testID {
      portraitPicture = nil
    }
  }

  private func sizeDidChange() {
    let new = bounds.size
    let old = lastSize
    lastSize = new
    let snap = pendingSnapshot
    pendingSnapshot = nil
    guard let snap, isTurn(from: old, to: new) else { return }
    beginTurn(from: old, to: new, snapshot: snap)
  }

  private func beginTurn(from old: CGSize, to new: CGSize, snapshot snap: UIView) {
    generation += 1
    let gen = generation
    // A turn back that starts before this one ended replaces it.
    endTurnState()
    resetLiveContent()
    morphTiming = morphAnimation().map(MorphTiming.init)
    startAnimationGuard()

    // This can run inside the UIKit transition animation: build the cover
    // with animations off, or UIKit fades its background in from clear.
    let oldCover = cover
    let newCover = UIView()
    cover = newCover
    snapshot = snap
    turn = Turn(to: new, start: CACurrentMediaTime())
    UIView.performWithoutAnimation {
      // On screen the stage morphs from the old size to the new size. Cover
      // the larger of both, so no part of it shows the live content.
      newCover.frame = CGRect(
        x: 0, y: 0,
        width: max(old.width, new.width),
        height: max(old.height, new.height)
      )
      newCover.backgroundColor = backdropColor ?? .clear
      newCover.isUserInteractionEnabled = false
      newCover.clipsToBounds = true
      snap.frame = CGRect(origin: .zero, size: old)
      // A turn back to portrait: the whole portrait page goes under the
      // snapshot, if it still shows what the content will show.
      turnPicture = nil
      if orientation(of: new) == "portrait" {
        if let picture = portraitPicture, picture.size == new,
           picture.testID == pictureTestID {
          picture.view.layer.removeAllAnimations()
          picture.view.layer.transform = CATransform3DIdentity
          picture.view.frame = CGRect(origin: .zero, size: new)
          // Shown only once the turn's mapping places it (applyLiveMapping).
          picture.view.isHidden = true
          newCover.addSubview(picture.view)
          turnPicture = picture.view
        }
        portraitPicture = nil
      }
      newCover.addSubview(snap)
      oldCover?.removeFromSuperview()
      addSubview(newCover)
    }

    // The transition commits at the end of this run loop turn. Read its
    // timing after that, to know when the morph ends.
    DispatchQueue.main.async { [weak self] in
      self?.scheduleMorphEnd(generation: gen)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + coverTimeout) { [weak self] in
      guard let self, self.generation == gen else { return }
      // Also when a touch has ended the turn: the guard must not outlive it.
      self.stopAnimationGuard()
      guard self.turn != nil else { return }
      self.liftCover()
    }
    // JS can render the new layout before UIKit resizes the stage.
    applySnapshotMapping()
    scheduleLiveMapping()
  }

  /// The bounds animation that UIKit added to the stage for this turn, if
  /// any. UIKit can add a suffix to the key (`bounds.size-2`), so match the
  /// key path, not the key.
  private func morphAnimation() -> CAPropertyAnimation? {
    let animations = (layer.animationKeys() ?? []).compactMap {
      layer.animation(forKey: $0) as? CAPropertyAnimation
    }
    for path in ["bounds.size", "bounds", "position"] {
      if let animation = animations.first(where: { $0.keyPath == path }) {
        return animation
      }
    }
    return nil
  }

  /// Schedules the end of the morph: the guard stops, the live content drops
  /// the stage transform, and a waiting cover can lift. A touch can end the
  /// turn before this runs (`turn` is nil then); the morph still runs, so the
  /// guard still stops at its end.
  private func scheduleMorphEnd(generation gen: Int) {
    guard generation == gen else { return }
    let start = turn?.start ?? CACurrentMediaTime()
    guard let base = morphAnimation() else {
      // A resize with no animation (a free window resize on iPadOS): nothing
      // moves, so the cover would only hide the new layout. Show it at once.
      endTurnNow()
      return
    }
    morphTiming = MorphTiming(base)
    var remaining: CFTimeInterval = 0
    let speed = base.speed == 0 ? 1 : CFTimeInterval(base.speed)
    if base.beginTime > 0 {
      let now = layer.convertTime(CACurrentMediaTime(), from: nil)
      remaining = max(0, base.beginTime + base.duration / speed - now)
    } else {
      // Not committed yet: it starts with the transaction of this turn.
      remaining = max(0, start + base.duration / speed - CACurrentMediaTime())
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + remaining + 0.02) { [weak self] in
      guard let self, self.generation == gen else { return }
      // The stage animation has run its course: drop the model transform.
      self.stopAnimationGuard()
      self.resetLiveContent()
      guard self.turn != nil else { return }
      self.turn?.morphDone = true
      self.liftCoverIfReady()
    }
  }

  // MARK: - JS input

  func setMapping(_ newMapping: RotationStageMapping?) {
    mapping = newMapping
    applySnapshotMapping()
    scheduleLiveMapping()
  }

  private var liveMappingScheduled = false

  /// Applies the live mapping after the current mount transaction: the stage
  /// can resize before Fabric sets the new frame of its content, and the
  /// content animation needs that frame (its anchor) and must remove the
  /// frame animations that UIKit adds to it in this transaction.
  private func scheduleLiveMapping() {
    guard !liveMappingScheduled else { return }
    liveMappingScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.liveMappingScheduled = false
      self.applyLiveMapping()
    }
  }

  /// JS reports that the new layout of turn `token` has painted the page to
  /// show. `testID` names that page's view: the cover waits until it sits
  /// inside the stage (the remounted list can show a neighbour page for a
  /// few frames). With no `testID`, two display frames are enough.
  func markReady(token: Int, orientation newOrientation: String, options: RotationStageReady) {
    let testID = options.testID
    guard let current = turn,
          isCurrent(token: token, orientation: newOrientation, turn: current)
    else { return }
    let gen = generation
    var framesInPlace = 0
    readyCheck?.cancel()
    readyCheck = FrameTicker { [weak self] in
      guard let self, self.generation == gen, self.turn != nil else { return false }
      let inPlace = testID.map { self.isShown(testID: $0) } ?? true
      framesInPlace = inPlace ? framesInPlace + 1 : 0
      // The first frame in place is the one being drawn; wait for it and one
      // more to be on screen.
      guard framesInPlace > framesAfterReady else { return true }
      self.readyCheck = nil
      self.turn?.ready = true
      self.turn?.waitForMorph = options.waitForMorph
      self.liftCoverIfReady()
      return false
    }
  }

  /// True when the view with `testID` is laid out inside the stage and is
  /// opaque. The conversion runs through the page list's mirror transforms
  /// (`inverted`), which keep a page that is shown inside the stage and move
  /// the others far outside it. A page that has not painted yet keeps
  /// opacity 0 (its reveal gate), also when it is the second view of that
  /// page in one turn.
  private func isShown(testID: String) -> Bool {
    guard let view = findView(testID: testID, in: self),
          !view.isHidden, view.alpha > 0.99
    else { return false }
    let frame = view.convert(view.bounds, to: self)
    return frame.width > 0
      && frame.minX >= -1 && frame.maxX <= bounds.width + 1
  }

  private func findView(testID: String, in view: UIView) -> UIView? {
    for child in view.subviews where child !== cover {
      if child.accessibilityIdentifier == testID { return child }
      if let found = findView(testID: testID, in: child) { return found }
    }
    return nil
  }

  /// True when `token` and `orientation` belong to the turn in progress:
  /// the orientation it goes to, and a token that no earlier turn used. A
  /// newer token than the one the turn has is newer data for the same turn.
  private func isCurrent(token: Int, orientation target: String, turn current: Turn) -> Bool {
    guard target == orientation(of: current.to) else { return false }
    return token > usedToken && token >= (current.token ?? 0)
  }

  // MARK: - Animation

  /// The live content: every direct child but the cover. The Mushaf reader
  /// mounts exactly one, a plain wrapper view.
  private var liveViews: [UIView] {
    subviews.filter { $0 !== cover }
  }

  /// The map of the mapping for the turn in progress (p' = s * p + t: the
  /// text block of the old page onto the text block of the new page), or nil.
  private func currentAffine() -> (CGFloat, CGFloat, CGFloat)? {
    guard let current = turn,
          let mapping,
          isCurrent(token: mapping.token, orientation: mapping.orientation, turn: current),
          mapping.fromWidth > 0, mapping.toWidth > 0
    else { return nil }
    turn?.token = mapping.token
    let s = CGFloat(mapping.toWidth / mapping.fromWidth)
    return (
      s,
      CGFloat(mapping.toX) - s * CGFloat(mapping.fromX),
      CGFloat(mapping.toY) - s * CGFloat(mapping.fromY)
    )
  }

  /// The snapshot moves from the old place to the new place. Applied at once,
  /// in the transaction that adds the cover, so that the first frame of the
  /// turn already shows the snapshot on its path.
  private func applySnapshotMapping() {
    guard let snapshot, let (s, tx, ty) = currentAffine() else { return }
    animate(snapshot.layer, from: (1, 0, 0), to: (s, tx, ty))
  }

  /// The live content moves from the old place to its own place, so that it
  /// matches the snapshot on every frame when the cover lifts mid-morph.
  private func applyLiveMapping() {
    guard cover != nil, let (s, tx, ty) = currentAffine() else { return }
    for view in liveViews {
      stripRotationAnimations(view)
      animate(view.layer, from: (1 / s, -tx / s, -ty / s), to: (1, 0, 0))
    }
    // The portrait picture stands in for the live content: the same path.
    // It shows from here on; a draw of the page removes it (`pageDrew`).
    if let turnPicture {
      animate(turnPicture.layer, from: (1 / s, -tx / s, -ty / s), to: (1, 0, 0))
      turnPicture.isHidden = false
    }
  }

  /// Sets the layer transform to the affine `to` (p' = s * p + t, in stage
  /// coordinates) and animates it from `from`, with the timing of the stage's
  /// own bounds animation, so it follows the UIKit morph on every frame.
  private func animate(
    _ target: CALayer,
    from: (CGFloat, CGFloat, CGFloat),
    to: (CGFloat, CGFloat, CGFloat)
  ) {
    // A layer transform applies about the anchor point (the layer position).
    let anchor = target.position
    func transform(_ a: (CGFloat, CGFloat, CGFloat)) -> CATransform3D {
      CATransform3DConcat(
        CATransform3DMakeScale(a.0, a.0, 1),
        CATransform3DMakeTranslation(a.1 - (1 - a.0) * anchor.x, a.2 - (1 - a.0) * anchor.y, 0)
      )
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    target.removeAnimation(forKey: stageAnimationKey)
    target.transform = transform(to)
    CATransaction.commit()

    // With no morph (a resize outside an animation), the layer jumps.
    guard let base = morphAnimation() else { return }
    // A copy keeps the curve; only the property and the values change.
    let animation: CABasicAnimation
    if let copy = base.copy() as? CABasicAnimation {
      animation = copy
    } else {
      animation = CABasicAnimation()
      animation.beginTime = base.beginTime
      animation.duration = base.duration
      animation.speed = base.speed
      animation.timeOffset = base.timeOffset
      animation.timingFunction = base.timingFunction
    }
    animation.keyPath = "transform"
    animation.fromValue = NSValue(caTransform3D: transform(from))
    animation.toValue = NSValue(caTransform3D: transform(to))
    animation.byValue = nil
    animation.isAdditive = false
    animation.delegate = nil
    animation.fillMode = .backwards
    animation.isRemovedOnCompletion = true
    target.add(animation, forKey: stageAnimationKey)
  }

  /// UIKit animates the React views inside the stage from their old values,
  /// because Fabric changes them while a rotation animation is running: the
  /// old views' frames, and on iOS 26 also the views that Fabric mounts during
  /// the morph (from a zero frame), the `inverted` list's mirror transform
  /// (through zero width) and a page's reveal opacity. The keys vary
  /// (`position`, `position-2`, `bounds.size-3`...), so match the key path.
  /// The stage's own animation (`stageAnimationKey`) moves the content.
  private func stripRotationAnimations(_ view: UIView) {
    let layer = view.layer
    for key in layer.animationKeys() ?? [] where key != stageAnimationKey {
      if let animation = layer.animation(forKey: key), isRotationAnimation(animation) {
        layer.removeAnimation(forKey: key)
      }
    }
    view.subviews.forEach(stripRotationAnimations)
  }

  /// The timing of the stage's morph, read when the turn starts and again
  /// before each commit while the morph runs.
  private var morphTiming: MorphTiming?

  /// True when UIKit added `animation` for this rotation: a UIKit key path,
  /// the morph's begin time, duration and curve, and it runs once and is
  /// removed on completion. An animation of the app's own (a looping
  /// indicator, an end state that stays) does not match, so it survives the
  /// turn.
  private func isRotationAnimation(_ animation: CAAnimation) -> Bool {
    guard let path = (animation as? CAPropertyAnimation)?.keyPath,
          uikitKeyPaths.contains(path),
          animation.repeatCount == 0, animation.repeatDuration == 0,
          !animation.autoreverses, animation.isRemovedOnCompletion,
          let morphTiming
    else { return false }
    return morphTiming.matches(animation)
  }

  /// While the morph runs, strips those animations before every Core
  /// Animation commit, so that none of them reaches the screen.
  private var animationGuard: CFRunLoopObserver?

  private func startAnimationGuard() {
    stopAnimationGuard()
    // Core Animation commits in an observer of order 2000000; UIKit's own
    // before-commit handler runs at 1999000. Run between the two.
    let observer = CFRunLoopObserverCreateWithHandler(
      kCFAllocatorDefault,
      CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue,
      true,
      1_999_500
    ) { [weak self] _, _ in
      guard let self else { return }
      // The morph's begin time is set when its transaction commits.
      if let morph = self.morphAnimation() {
        self.morphTiming = MorphTiming(morph)
      }
      self.liveViews.forEach(self.stripRotationAnimations)
    }
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
    animationGuard = observer
  }

  private func stopAnimationGuard() {
    if let animationGuard {
      CFRunLoopObserverInvalidate(animationGuard)
    }
    animationGuard = nil
  }

  /// Gives the live content back without the stage transform.
  private func resetLiveContent() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for view in liveViews {
      view.layer.removeAnimation(forKey: stageAnimationKey)
      view.layer.transform = CATransform3DIdentity
    }
    CATransaction.commit()
  }

  // MARK: - Cover

  /// The ONE rule that lifts the cover for a ready turn (see the header).
  private func liftCoverIfReady() {
    guard let current = turn, current.ready else { return }
    guard current.morphDone || !current.waitForMorph else { return }
    liftCover()
  }

  private func touchBegan() {
    guard turn != nil else { return }
    liftCover()
  }

  /// Ends the turn and removes the cover (a cut: the snapshot sits on the
  /// new content, or the new layout re-flows, and a fade would show two
  /// pictures at once).
  private func liftCover() {
    let morphDone = turn?.morphDone ?? true
    endTurnState()
    guard let oldCover = cover else { return }
    cover = nil
    snapshot = nil
    turnPicture = nil
    // Views mounted during the turn sit at their final frames already.
    liveViews.forEach(stripRotationAnimations)
    if morphDone {
      resetLiveContent()
    }
    UIView.performWithoutAnimation { oldCover.removeFromSuperview() }
  }

  /// Ends a turn at once and gives the content back: the stage left its
  /// window, or UIKit resized it without an animation.
  private func endTurnNow() {
    generation += 1
    stopAnimationGuard()
    liftCover()
    resetLiveContent()
  }

  private func endTurnState() {
    readyCheck?.cancel()
    readyCheck = nil
    if let token = turn?.token {
      usedToken = max(usedToken, token)
    }
    turn = nil
  }

  // MARK: - Lifecycle

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // The reader left the screen during a turn: end it.
    if window == nil, turn != nil || cover != nil {
      endTurnNow()
    }
    if window == nil {
      portraitPicture = nil
    }
  }

  deinit {
    stopAnimationGuard()
    readyCheck?.cancel()
  }

  // MARK: - Children

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    // Keep the cover above content that Fabric mounts during a turn.
    if let cover, subview !== cover {
      bringSubviewToFront(cover)
    }
  }
}

/// Reports the start of a touch and never recognizes, so it never takes a
/// touch from the views below.
private final class TouchBeganRecognizer: UIGestureRecognizer {
  var onBegan: (() -> Void)?

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    onBegan?()
    state = .failed
  }
}

/// Calls `tick` on every display frame, on the main thread, while it returns
/// true.
private final class FrameTicker: NSObject {
  private var link: CADisplayLink?
  private let tick: () -> Bool

  init(tick: @escaping () -> Bool) {
    self.tick = tick
    super.init()
    let link = CADisplayLink(target: self, selector: #selector(step))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  @objc private func step() {
    if !tick() {
      cancel()
    }
  }

  func cancel() {
    link?.invalidate()
    link = nil
  }
}
