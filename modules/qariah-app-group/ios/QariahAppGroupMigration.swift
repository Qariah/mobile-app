// @ai Qariah (TECH_DEBT #289, Sprint 50): the one-time move of the beta data
// from the production App Group to the beta App Group.
//
// This file uses Foundation only, so that a test compiles it on macOS with
// swiftc (modules/qariah-app-group/test/main.swift). The app calls it from
// QariahAppGroupAppDelegate.swift.

import Foundation

/// Moves the data of the internal beta from its old App Group to its own App
/// Group, one time.
///
/// Until Sprint 50 the beta (`<production id>.beta`) used the production
/// group. react-native-mmkv keeps every MMKV instance in the root of the
/// container of `AppGroupIdentifier` (the language, the device id, the
/// notification state, the Mushaf session and caches), and the widgets keep
/// their files in `widgets/`. A beta build now has its own group. For one
/// release its app entitlements also list the old group, and its Info.plist
/// names the old group in `QariahLegacyAppGroup` (scripts/ios-archive.sh
/// --beta). At the first launch, before React Native starts (so that no MMKV
/// file is open), `run` copies the old data into the new container and writes
/// a marker.
///
/// Rules:
/// - It only reads the old container. The production app also uses it.
/// - It copies each top-level item of the old container, except hidden items
///   (the container metadata of the system) and `Library` (the preferences and
///   caches of the old group identifier).
/// - A top-level file (an MMKV file) replaces the file with the same name in
///   the new container. Before the marker exists, the new container can only
///   hold data from a launch where the move did not run, and the old data is
///   the data of the user.
/// - A folder (for example `widgets/`) is merged. An item that is already in
///   the new container stays.
/// - Each file goes to a hidden temporary name first and is then renamed, so a
///   process that stops during the copy does not leave half of an MMKV file.
/// - It writes the marker BEFORE the first copy (TECH_DEBT #289 review). The
///   copy can then run only one time, also when a later write fails: a full
///   device (QARIAHV2-20) can refuse the final marker update after the copy,
///   and without a marker each later launch would put the old data over the
///   data that the app changed since. When it cannot write the marker, it
///   copies nothing and tries again at the next launch.
/// - When the old container cannot be read, or every item fails (for example
///   a launch before the first unlock after a restart, when the files are not
///   readable yet), it copies nothing, removes the marker, and tries again at
///   the next launch. When some items fail, it copies the other items, records
///   the failure in the marker, and does not run again.
/// - A process that stops during the copy leaves the marker, so the move does
///   not run again. Some old items are then not in the new container. This
///   costs less than a second copy over changed data.
public enum QariahAppGroupMigration {
  /// The marker in the new container. A hidden name, so it is never copied.
  public static let markerName = ".qariah-app-group-migration.plist"
  static let temporaryPrefix = ".qariah-app-group-tmp-"
  static let skippedNames: Set<String> = ["Library"]

  public enum Outcome: Equatable {
    /// No old group is configured, or it is the same as the new group.
    case notConfigured
    /// A container cannot be read. Nothing changed; the next launch tries again.
    case unavailable(String)
    /// The marker exists.
    case alreadyDone
    /// The move ran. `copied` and `failed` name top-level items.
    case moved(copied: [String], failed: [String])
    /// The items were copied, but the final marker update failed. The first
    /// marker stays, so the move does not run again.
    case markerFailed(String)
  }

  /// Writes the marker data to the marker URL. Tests replace it to make a
  /// write fail.
  public typealias MarkerWriter = (Data, URL) throws -> Void

  public static func writeMarkerAtomically(_ data: Data, _ url: URL) throws {
    try data.write(to: url, options: .atomic)
  }

  /// True when the build names an old group that is not its own group.
  public static func isConfigured(legacyGroup: String?, currentGroup: String?) -> Bool {
    guard let legacy = legacyGroup, let current = currentGroup,
      !legacy.isEmpty, !current.isEmpty
    else { return false }
    return legacy != current
  }

  /// Moves the data from the `legacy` container to the `current` container.
  /// A nil URL means the system did not give the container (no entitlement).
  public static func run(
    from legacy: URL?,
    to current: URL?,
    legacyGroup: String,
    fileManager fm: FileManager = .default,
    now: Date = Date(),
    writeMarker: MarkerWriter = writeMarkerAtomically
  ) -> Outcome {
    guard let current = current else { return .unavailable("no container for the new group") }
    let marker = current.appendingPathComponent(markerName)
    if fm.fileExists(atPath: marker.path) { return .alreadyDone }
    guard let legacy = legacy else { return .unavailable("no container for \(legacyGroup)") }

    let items: [URL]
    do {
      items = try fm.contentsOfDirectory(
        at: legacy,
        includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
        options: [])
    } catch {
      return .unavailable("cannot list \(legacyGroup): \(error.localizedDescription)")
    }

    // The marker comes first: after this write, the copy cannot run again.
    let started: [String: Any] = [
      "version": 1,
      "state": "copying",
      "startedAt": now,
      "from": legacyGroup,
    ]
    do {
      try writeMarker(
        try PropertyListSerialization.data(fromPropertyList: started, format: .xml, options: 0),
        marker)
    } catch {
      return .unavailable("cannot write the marker: \(error.localizedDescription)")
    }

    removeTemporaryItems(in: current, fileManager: fm)

    var copied: [String] = []
    var failed: [String] = []
    for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
      let name = item.lastPathComponent
      if name.hasPrefix(".") || skippedNames.contains(name) { continue }
      let target = current.appendingPathComponent(name)
      do {
        switch try kind(of: item) {
        case .file:
          try copyReplacing(item, to: target, fileManager: fm)
        case .folder:
          try merge(item, into: target, fileManager: fm)
        case .other:
          continue
        }
        copied.append(name)
      } catch {
        failed.append(name)
      }
    }
    if copied.isEmpty && !failed.isEmpty {
      // Nothing was copied, so a new try cannot put old data over new data.
      // If the remove fails, the marker stays and the move does not run again.
      try? fm.removeItem(at: marker)
      return .unavailable("no item of \(legacyGroup) could be copied: \(failed)")
    }

    let record: [String: Any] = [
      "version": 1,
      "state": "done",
      "movedAt": now,
      "from": legacyGroup,
      "copied": copied,
      "failed": failed,
    ]
    do {
      try writeMarker(
        try PropertyListSerialization.data(fromPropertyList: record, format: .xml, options: 0),
        marker)
    } catch {
      return .markerFailed(error.localizedDescription)
    }
    return .moved(copied: copied, failed: failed)
  }

  enum Kind { case file, folder, other }

  static func kind(of url: URL) throws -> Kind {
    let values = try url.resourceValues(
      forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
    if values.isSymbolicLink == true { return .other }
    if values.isDirectory == true { return .folder }
    if values.isRegularFile == true { return .file }
    return .other
  }

  /// Copies `source` to `target` through a hidden temporary name, and replaces
  /// `target` when it exists.
  static func copyReplacing(_ source: URL, to target: URL, fileManager fm: FileManager) throws {
    let temporary = target.deletingLastPathComponent()
      .appendingPathComponent(temporaryPrefix + target.lastPathComponent)
    try? fm.removeItem(at: temporary)
    try fm.copyItem(at: source, to: temporary)
    if fm.fileExists(atPath: target.path) {
      try fm.removeItem(at: target)
    }
    try fm.moveItem(at: temporary, to: target)
  }

  /// Copies each item of `source` that `target` does not have. Keeps every
  /// item that `target` has.
  static func merge(_ source: URL, into target: URL, fileManager fm: FileManager) throws {
    var isFolder: ObjCBool = false
    if !fm.fileExists(atPath: target.path, isDirectory: &isFolder) {
      try copyReplacing(source, to: target, fileManager: fm)
      return
    }
    guard isFolder.boolValue else {
      throw CocoaError(.fileWriteFileExists)
    }
    let children = try fm.contentsOfDirectory(
      at: source,
      includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
      options: [])
    for child in children {
      if child.lastPathComponent.hasPrefix(temporaryPrefix) { continue }
      let destination = target.appendingPathComponent(child.lastPathComponent)
      switch try kind(of: child) {
      case .folder:
        try merge(child, into: destination, fileManager: fm)
      case .file:
        if !fm.fileExists(atPath: destination.path) {
          try copyReplacing(child, to: destination, fileManager: fm)
        }
      case .other:
        continue
      }
    }
  }

  /// Removes the temporary items that a stopped run left at the top level.
  static func removeTemporaryItems(in folder: URL, fileManager fm: FileManager) {
    guard let names = try? fm.contentsOfDirectory(atPath: folder.path) else { return }
    for name in names where name.hasPrefix(temporaryPrefix) {
      try? fm.removeItem(at: folder.appendingPathComponent(name))
    }
  }
}
