// targets/widgets/_shared/WidgetSnapshot.swift
import Foundation

struct WidgetTrack: Codable, Hashable {
  let surahId: Int
  let surahName: String
  let reciterId: String
  let reciterName: String
  let rewayatId: String?
  let artworkFile: String?
  let isUserUpload: Bool
}

struct WidgetNowPlaying: Codable, Hashable {
  let track: WidgetTrack
  let isPlaying: Bool
  let positionSec: Double
  let durationSec: Double
  let rate: Double
}

struct WidgetReciter: Codable, Hashable {
  let id: String
  let name: String
  let artworkFile: String?
}

struct WidgetLastRead: Codable, Hashable {
  let page: Int
  let surahId: Int
  let surahName: String
  let juz: Int
  let openingText: String
}

struct WidgetTasbeehEntry: Codable, Hashable {
  let count: Int
  let target: Int
  let day: String
}

enum WidgetTheme: String, Codable {
  case light, dark, system
}

// @ai-start
/// The adhkar session's player, which is separate from nowPlaying.
struct WidgetAdhkarPlayback: Codable, Hashable {
  let superId: String
  let dhikrId: String
  let isPlaying: Bool
}
// @ai-end

struct WidgetSnapshot: Codable {
  static let supportedVersion = 1
  let version: Int
  let generatedAt: Double
  let theme: WidgetTheme
  let nowPlaying: WidgetNowPlaying?
  let upNext: [WidgetTrack]
  let recent: [WidgetTrack]
  let defaultReciter: WidgetReciter?
  let reciterRecents: [String: [WidgetTrack]]
  let lastRead: WidgetLastRead?
  let tasbeeh: [String: WidgetTasbeehEntry]
  // nil when no adhkar session exists, or in snapshots from older app builds. // @ai
  // Qariah: `var` with a nil default (upstream: `let`), so the memberwise calls in
  // scripts/check-widget-*.sh compile without an adhkar argument. It still decodes.
  var adhkar: WidgetAdhkarPlayback? = nil // @ai
  // @ai Qariah (TECH_DEBT #357): the app language (WidgetLanguage); nil in an older app's snapshot.
  var language: String? = nil

  static func decode(_ data: Data) -> WidgetSnapshot? {
    guard let s = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
          s.version == supportedVersion else { return nil }
    return s
  }
}
