// targets/widgets/Support/WidgetLanguage.swift
// @ai Qariah (TECH_DEBT #357)
import SwiftUI

/// Widget text in the app's UI language, not the device language. The app
/// writes its language into the snapshot (`language`), so a person who picks
/// Arabic in the app on an English iPhone also gets Arabic widgets. A
/// snapshot with no language (the app keeps "System default", or an older app
/// build) makes the widgets follow the device language, also right after a
/// change of it. Mirrors WidgetLanguage.kt on Android.
enum WidgetLanguage {
  /// Languages whose readers see Arabic surah names and no English ayah
  /// translation in the app (`bilingualContent` and `understandsArabic` in
  /// i18n/languages.ts).
  private static let arabicContentCodes: Set<String> = ["ar"]

  /// The app language that the app last wrote, or nil.
  static func current() -> String? { SnapshotStore.load()?.language }

  /// The primary language subtag ("ar" for "ar-EG"), or nil.
  static func code(_ language: String?) -> String? {
    guard let language else { return nil }
    let primary = language.trimmingCharacters(in: .whitespaces)
      .split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map { $0.lowercased() }
    return primary?.isEmpty == false ? primary : nil
  }

  /// `language`, or the device language (the language of the extension's
  /// own strings) when the snapshot has none.
  static func resolve(_ language: String?) -> String? {
    code(language) ?? code(Bundle.main.preferredLocalizations.first)
  }

  static func arabicContent(_ language: String?) -> Bool {
    resolve(language).map(arabicContentCodes.contains) ?? false
  }

  /// The surah name a widget shows in `language`: the Arabic name for Arabic content.
  static func surahName(_ surah: StaticSurah, _ language: String?) -> String {
    arabicContent(language) ? (surah.nameArabic ?? surah.name) : surah.name
  }

  /// The locale for a language code. Arabic content uses Arabic-Indic digits,
  /// as the app does (`digits` in i18n/languages.ts); a plain "ar" locale
  /// formats Latin digits on iOS.
  static func locale(_ code: String) -> Locale {
    Locale(identifier: arabicContentCodes.contains(code) ? "\(code)@numbers=arab" : code)
  }

  /// A whole number in the digits of `language` (Arabic-Indic for Arabic).
  static func number(_ value: Int, _ language: String?) -> String {
    guard let code = resolve(language) else { return String(value) }
    return value.formatted(.number.grouping(.never).locale(locale(code)))
  }
}

extension View {
  /// Strings, number formats and layout direction in `language`, as on a
  /// device in that language. Unchanged when `language` is nil.
  @ViewBuilder func widgetLanguage(_ language: String?) -> some View {
    if let code = WidgetLanguage.code(language) {
      environment(\.locale, WidgetLanguage.locale(code))
        .environment(\.layoutDirection,
                     Locale.Language(identifier: code).characterDirection == .rightToLeft ? .rightToLeft : .leftToRight)
    } else {
      self
    }
  }
}
