// @ai Qariah (TECH_DEBT #289): the test of QariahAppGroupMigration.swift.
// __tests__/QariahAppGroupMigration.test.ts compiles this file with
// ../ios/QariahAppGroupMigration.swift (swiftc, macOS) and runs it with a
// temporary folder as its argument. It prints one line for each case and
// "ALL PASS" at the end; a failed case exits 1.

import Foundation

let fm = FileManager.default
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
var failures = 0
var caseNumber = 0

func check(_ condition: Bool, _ message: String, line: Int = #line) {
  if !condition {
    failures += 1
    print("FAIL (line \(line)): \(message)")
  }
}

func write(_ text: String, _ url: URL) {
  try! fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  try! text.data(using: .utf8)!.write(to: url)
}

func text(_ url: URL) -> String? {
  guard let data = try? Data(contentsOf: url) else { return nil }
  return String(data: data, encoding: .utf8)
}

func exists(_ url: URL) -> Bool { fm.fileExists(atPath: url.path) }

/// A fresh pair of containers for one case.
func containers(_ name: String) -> (old: URL, new: URL) {
  caseNumber += 1
  let base = root.appendingPathComponent("\(caseNumber)-\(name)", isDirectory: true)
  let old = base.appendingPathComponent("old", isDirectory: true)
  let new = base.appendingPathComponent("new", isDirectory: true)
  try! fm.createDirectory(at: old, withIntermediateDirectories: true)
  try! fm.createDirectory(at: new, withIntermediateDirectories: true)
  return (old, new)
}

/// What a real group container holds: system metadata, Library, MMKV files
/// (`<id>` and `<id>.crc`) and the widget files.
func fillOld(_ old: URL) {
  write("system", old.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist"))
  write("prefs", old.appendingPathComponent("Library/Preferences/group.old.plist"))
  write("i18n-old", old.appendingPathComponent("i18n"))
  write("i18n-crc-old", old.appendingPathComponent("i18n.crc"))
  write("analytics-old", old.appendingPathComponent("analytics"))
  write("analytics-crc-old", old.appendingPathComponent("analytics.crc"))
  write("snapshot-old", old.appendingPathComponent("widgets/snapshot.json"))
  write("art-old", old.appendingPathComponent("widgets/artwork/surah-1.png"))
}

let legacyGroup = "group.example.app"

// 1. The decision: only a different, non-empty old group runs the move.
do {
  check(!QariahAppGroupMigration.isConfigured(legacyGroup: nil, currentGroup: "group.a.b"), "nil old group")
  check(!QariahAppGroupMigration.isConfigured(legacyGroup: "", currentGroup: "group.a.b"), "empty old group")
  check(!QariahAppGroupMigration.isConfigured(legacyGroup: "group.a.b", currentGroup: "group.a.b"), "same group")
  check(!QariahAppGroupMigration.isConfigured(legacyGroup: "group.a.b", currentGroup: nil), "no new group")
  check(QariahAppGroupMigration.isConfigured(legacyGroup: "group.a.b", currentGroup: "group.a.b.beta"), "beta")
  print("case decision")
}

// 2. The first launch copies the data, keeps the old container, writes the marker.
do {
  let (old, new) = containers("first-launch")
  fillOld(old)
  write("own-system", new.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist"))
  let oldBefore = try! fm.subpathsOfDirectory(atPath: old.path).sorted()
  let outcome = QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
  check(outcome == .moved(copied: ["analytics", "analytics.crc", "i18n", "i18n.crc", "widgets"], failed: []),
        "outcome \(outcome)")
  check(text(new.appendingPathComponent("i18n")) == "i18n-old", "i18n copied")
  check(text(new.appendingPathComponent("analytics.crc")) == "analytics-crc-old", "crc copied")
  check(text(new.appendingPathComponent("widgets/snapshot.json")) == "snapshot-old", "widget file copied")
  check(text(new.appendingPathComponent("widgets/artwork/surah-1.png")) == "art-old", "artwork copied")
  check(!exists(new.appendingPathComponent("Library")), "Library not copied")
  check(text(new.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist")) == "own-system",
        "the system metadata of the new container stays")
  check(exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "marker written")
  let oldAfter = try! fm.subpathsOfDirectory(atPath: old.path).sorted()
  check(oldBefore == oldAfter, "the old container is not changed")
  check(text(old.appendingPathComponent("i18n")) == "i18n-old", "the old file is not changed")
  let leftovers = try! fm.contentsOfDirectory(atPath: new.path).filter { $0.hasPrefix(".qariah-app-group-tmp-") }
  check(leftovers.isEmpty, "no temporary file left: \(leftovers)")
  let marker = try! PropertyListSerialization.propertyList(
    from: Data(contentsOf: new.appendingPathComponent(QariahAppGroupMigration.markerName)),
    format: nil) as! [String: Any]
  check(marker["from"] as? String == legacyGroup, "marker names the old group")
  check(marker["state"] as? String == "done", "the final marker says done")
  check((marker["copied"] as? [String])?.count == 5, "marker lists the copied items")

  // 3. The next launch does nothing: the beta data is never replaced again.
  write("i18n-new", new.appendingPathComponent("i18n"))
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) == .alreadyDone, "second run")
  check(text(new.appendingPathComponent("i18n")) == "i18n-new", "the second run keeps the new data")
  print("case first-launch and second launch")
}

// 4. A launch that did not move the data left files: the old MMKV files
//    replace them, and a folder is merged (the items in it stay).
do {
  let (old, new) = containers("merge")
  fillOld(old)
  write("fresh-empty", new.appendingPathComponent("i18n"))
  write("fresh-crc", new.appendingPathComponent("i18n.crc"))
  write("only-new", new.appendingPathComponent("trending"))
  write("lock", new.appendingPathComponent("widgets/queue.lock"))
  write("snapshot-new", new.appendingPathComponent("widgets/snapshot.json"))
  write("half", new.appendingPathComponent(".qariah-app-group-tmp-analytics"))
  let outcome = QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
  check(outcome == .moved(copied: ["analytics", "analytics.crc", "i18n", "i18n.crc", "widgets"], failed: []),
        "outcome \(outcome)")
  check(text(new.appendingPathComponent("i18n")) == "i18n-old", "the old MMKV file replaces the fresh one")
  check(text(new.appendingPathComponent("i18n.crc")) == "i18n-crc-old", "and its crc")
  check(text(new.appendingPathComponent("trending")) == "only-new", "a file only in the new container stays")
  check(text(new.appendingPathComponent("widgets/queue.lock")) == "lock", "a widget file only in the new container stays")
  check(text(new.appendingPathComponent("widgets/snapshot.json")) == "snapshot-new", "a merged folder keeps its items")
  check(text(new.appendingPathComponent("widgets/artwork/surah-1.png")) == "art-old", "a merged folder gets the missing items")
  check(!exists(new.appendingPathComponent(".qariah-app-group-tmp-analytics")), "a stale temporary file is removed")
  print("case merge")
}

// 5. A container that the system does not give, or that cannot be read:
//    nothing changes, no marker, the next launch tries again.
do {
  let (old, new) = containers("unavailable")
  fillOld(old)
  if case .unavailable = QariahAppGroupMigration.run(from: nil, to: new, legacyGroup: legacyGroup) {} else {
    check(false, "no old container")
  }
  if case .unavailable = QariahAppGroupMigration.run(from: old, to: nil, legacyGroup: legacyGroup) {} else {
    check(false, "no new container")
  }
  let missing = old.appendingPathComponent("does-not-exist", isDirectory: true)
  if case .unavailable = QariahAppGroupMigration.run(from: missing, to: new, legacyGroup: legacyGroup) {} else {
    check(false, "an old container that cannot be listed")
  }
  check(!exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "no marker")
  check((try! fm.contentsOfDirectory(atPath: new.path)).isEmpty, "nothing copied")
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
        == .moved(copied: ["analytics", "analytics.crc", "i18n", "i18n.crc", "widgets"], failed: []),
        "the next launch moves the data")
  print("case unavailable then retry")
}

// 6. An empty old container (a fresh install with no old app): a marker, no copy.
do {
  let (old, new) = containers("empty")
  write("system", old.appendingPathComponent(".com.apple.mobile_container_manager.metadata.plist"))
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) == .moved(copied: [], failed: []),
        "empty old container")
  check(exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "marker written")
  print("case empty")
}

// 7. One item fails (a file where the new container needs a folder): the
//    other items move, the marker records the failure, and no retry runs.
do {
  let (old, new) = containers("partial")
  fillOld(old)
  write("not-a-folder", new.appendingPathComponent("widgets"))
  let outcome = QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
  check(outcome == .moved(copied: ["analytics", "analytics.crc", "i18n", "i18n.crc"], failed: ["widgets"]),
        "outcome \(outcome)")
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) == .alreadyDone, "no retry")
  print("case partial failure")
}

// 8. Every item fails (as before the first unlock after a restart): no
//    marker, nothing copied, and the next launch tries again.
do {
  let (old, new) = containers("all-failed")
  write("snapshot-old", old.appendingPathComponent("widgets/snapshot.json"))
  write("not-a-folder", new.appendingPathComponent("widgets"))
  if case .unavailable = QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) {} else {
    check(false, "every item failed")
  }
  check(!exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "no marker")
  try! fm.removeItem(at: new.appendingPathComponent("widgets"))
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
        == .moved(copied: ["widgets"], failed: []),
        "the next launch moves the data")
  print("case all failed then retry")
}

// 9. TECH_DEBT #289 review (Low 1): the final marker update fails after the
//    copy (a full device). The first marker stays, so a later launch does
//    not put the old data over the data that the app changed since.
do {
  let (old, new) = containers("final-marker-fails")
  fillOld(old)
  var writes = 0
  let failSecondWrite: QariahAppGroupMigration.MarkerWriter = { data, url in
    writes += 1
    if writes == 2 { throw CocoaError(.fileWriteOutOfSpace) }
    try QariahAppGroupMigration.writeMarkerAtomically(data, url)
  }
  if case .markerFailed = QariahAppGroupMigration.run(
    from: old, to: new, legacyGroup: legacyGroup, writeMarker: failSecondWrite) {} else {
    check(false, "the final marker update failed")
  }
  check(text(new.appendingPathComponent("i18n")) == "i18n-old", "the data was copied")
  check(exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "the first marker stays")
  // React Native changes the data, then the app launches again.
  write("i18n-changed-by-the-app", new.appendingPathComponent("i18n"))
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) == .alreadyDone,
        "no second copy")
  check(text(new.appendingPathComponent("i18n")) == "i18n-changed-by-the-app",
        "the data that the app changed stays")
  print("case final marker update fails")
}

// 10. The first marker cannot be written (a full device): nothing is copied,
//     the new container is not changed, and a later launch moves the data.
do {
  let (old, new) = containers("first-marker-fails")
  fillOld(old)
  write("fresh", new.appendingPathComponent("i18n"))
  let refuse: QariahAppGroupMigration.MarkerWriter = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
  if case .unavailable = QariahAppGroupMigration.run(
    from: old, to: new, legacyGroup: legacyGroup, writeMarker: refuse) {} else {
    check(false, "the first marker write failed")
  }
  check(text(new.appendingPathComponent("i18n")) == "fresh", "nothing was copied")
  check(!exists(new.appendingPathComponent("analytics")), "no old item in the new container")
  check(!exists(new.appendingPathComponent(QariahAppGroupMigration.markerName)), "no marker")
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup)
        == .moved(copied: ["analytics", "analytics.crc", "i18n", "i18n.crc", "widgets"], failed: []),
        "the next launch moves the data")
  print("case first marker fails then retry")
}

// 11. A read-only new container (no write at all): the same as case 10.
do {
  let (old, new) = containers("read-only")
  fillOld(old)
  try! fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: new.path)
  if case .unavailable = QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) {} else {
    check(false, "a read-only container")
  }
  try! fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: new.path)
  check((try! fm.contentsOfDirectory(atPath: new.path)).isEmpty, "nothing copied")
  print("case read-only container")
}

// 12. A symbolic link in the old container is not followed.
do {
  let (old, new) = containers("symlink")
  write("secret", root.appendingPathComponent("outside.txt"))
  try! fm.createSymbolicLink(at: old.appendingPathComponent("link"), withDestinationURL: root.appendingPathComponent("outside.txt"))
  check(QariahAppGroupMigration.run(from: old, to: new, legacyGroup: legacyGroup) == .moved(copied: [], failed: []),
        "a link is not copied")
  check(!exists(new.appendingPathComponent("link")), "no link in the new container")
  print("case symlink")
}

if failures > 0 {
  print("\(failures) FAILED")
  exit(1)
}
print("ALL PASS")
