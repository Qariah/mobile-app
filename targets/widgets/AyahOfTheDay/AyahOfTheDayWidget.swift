// targets/widgets/AyahOfTheDay/AyahOfTheDayWidget.swift
import AppIntents
import SwiftUI
import WidgetKit

struct AyahOfTheDayEntry: TimelineEntry {
  let date: Date
  let ayah: StaticAyah?
  // @ai Qariah (TECH_DEBT #357): the app language (WidgetLanguage).
  var language: String? = nil
}

struct AyahOfTheDayProvider: TimelineProvider {
  func placeholder(in context: Context) -> AyahOfTheDayEntry {
    AyahOfTheDayEntry(date: .now, ayah: StaticData.ayahOfTheDay(.now), language: WidgetLanguage.current())
  }

  func getSnapshot(in context: Context, completion: @escaping (AyahOfTheDayEntry) -> Void) {
    completion(placeholder(in: context))
  }

  // Today's ayah now and tomorrow's at midnight; then WidgetKit asks again.
  func getTimeline(in context: Context, completion: @escaping (Timeline<AyahOfTheDayEntry>) -> Void) {
    let now = Date.now
    let midnight = WidgetLogic.nextMidnight(after: now)
    let language = WidgetLanguage.current()
    completion(Timeline(entries: [
      AyahOfTheDayEntry(date: now, ayah: StaticData.ayahOfTheDay(now), language: language),
      AyahOfTheDayEntry(date: midnight, ayah: StaticData.ayahOfTheDay(midnight), language: language),
    ], policy: .atEnd))
  }
}

struct AyahOfTheDayWidget: Widget {
  let kind = "AyahOfTheDay"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AyahOfTheDayProvider()) { entry in
      AyahOfTheDayView(entry: entry)
    }
    .configurationDisplayName("Ayah of the Day")
    .description("A new ayah every day, in Digital Khatt.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

struct AyahOfTheDayView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme // @ai
  let entry: AyahOfTheDayEntry

  // @ai-start
  private var style: ReadingStyle { .forScheme(colorScheme) }

  // @ai-end
  var body: some View {
    Group {
      if let ayah = entry.ayah {
        content(ayah)
      } else {
        Text("Open \(AppBrand.name)").font(.caption.weight(.semibold))
      }
    }
    // @ai-start
    .foregroundStyle(style.primary)
    .containerBackground(for: .widget) { style.background }
    // @ai-end
    .widgetURL(entry.ayah.flatMap { AppLinks.url("quran/\($0.surahId)?ayah=\($0.ayah)") })
    .widgetLanguage(entry.language)
  }

  // @ai Qariah (TECH_DEBT #357): readers of Arabic see no English translation, as in the app.
  private var showsTranslation: Bool { !WidgetLanguage.arabicContent(entry.language) }

  /// "Hud 11:6": the surah name and the verse key, in the app language and its digits.
  private func reference(_ ayah: StaticAyah) -> String {
    let name = StaticData.surah(ayah.surahId).map { WidgetLanguage.surahName($0, entry.language) } ?? ayah.surahName
    let key = "\(WidgetLanguage.number(ayah.surahId, entry.language)):\(WidgetLanguage.number(ayah.ayah, entry.language))"
    return WidgetLogic.reference(surahName: name, key: key)
  }

  @ViewBuilder private func content(_ ayah: StaticAyah) -> some View {
    switch family {
    case .systemSmall:
      // @ai-start
      VStack(alignment: .leading, spacing: 4) {
        // Qariah (TECH_DEBT #357): the String Catalog key "Ayah of the Day" (it has the Arabic);
        // the eyebrow is uppercase, so the English does not change.
        Eyebrow(text: "Ayah of the Day", color: style.label)
        arabic(ayah, size: 28, lines: 4).frame(maxHeight: .infinity)
        HStack {
          Text(reference(ayah)).font(.caption.weight(.bold)).foregroundStyle(style.secondary).lineLimit(1)
          Spacer(minLength: 4)
          listen(ayah, size: 32)
        }
      // @ai-end
      }
      .padding(14) // @ai
    case .systemMedium:
      // @ai-start
      VStack(spacing: 4) {
        HStack {
          Eyebrow(text: "Ayah of the Day · \(reference(ayah))", color: style.label) // Qariah: key "Ayah of the Day · %@"
          Spacer(minLength: 4)
          listen(ayah, size: 28)
        }
        arabic(ayah, size: 22, lines: showsTranslation ? 2 : 3).frame(maxHeight: .infinity)
        // Qariah (TECH_DEBT #357): no English translation (and no rule above it) for readers of Arabic.
        if showsTranslation {
          Rectangle().fill(style.rule).frame(height: 1).padding(.horizontal, 40)
          Text(ayah.translation).font(.caption).foregroundStyle(style.secondary)
            .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.85)
        }
      // @ai-end
      }
      // @ai-start
      .padding(.horizontal, 18)
      .padding(.vertical, 14)
      // @ai-end
    default:
      // @ai-start
      VStack(spacing: 10) {
        // Qariah (TECH_DEBT #353): BayaanLogo draws the fork's BrandMark when it has one (RFC-021).
        BayaanLogo(size: 22).foregroundStyle(style.label)
      // @ai-end
        Spacer(minLength: 0)
        // @ai-start
        arabic(ayah, size: 26, lines: 6)
        if showsTranslation { // Qariah (TECH_DEBT #357)
          Text(ayah.translation).font(.footnote).foregroundStyle(style.secondary)
            .multilineTextAlignment(.center).lineLimit(5)
        }
        // @ai-end
        Spacer(minLength: 0)
        // @ai-start
        HStack {
          Text(reference(ayah)).font(.caption.weight(.bold)).foregroundStyle(style.label).lineLimit(1)
          Spacer(minLength: 4)
          PlayOrPauseButton(playing: isPlaying(ayah), play: listenIntent(ayah), label: "Listen") { playing in
            Label(playing ? "Pause" : "Listen", systemImage: playing ? "pause.fill" : "play.fill")
              .font(.caption.weight(.heavy))
              .foregroundStyle(style.buttonGlyph)
              .padding(.horizontal, 14)
              .frame(height: 32)
              .background(style.buttonFill, in: Capsule())
          }
        }
      }
      .padding(.horizontal, 26)
      .padding(.top, 26)
      .padding(.bottom, 20)
      // A thin inset frame, like the border of a mushaf page.
      .background {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(style.rule, lineWidth: 1)
          .padding(10)
        // @ai-end
      }
    }
  }

  // @ai-start
  private func listenIntent(_ ayah: StaticAyah) -> PlayTrackIntent {
    PlayTrackIntent(surahId: ayah.surahId, reciterId: nil, rewayatId: nil, ayah: ayah.ayah)
  }

  /// The ayah's surah is playing, from any reciter.
  private func isPlaying(_ ayah: StaticAyah) -> Bool {
    PlayingNow.matches(PlayingNow.track(at: entry.date), surahId: ayah.surahId, reciterId: nil)
  }

  private func listen(_ ayah: StaticAyah, size: CGFloat) -> some View {
    PlayOrPauseButton(playing: isPlaying(ayah), play: listenIntent(ayah), label: "Listen") { playing in
      PrimaryGlyph(systemName: playing ? "pause.fill" : "play.fill", size: size, fill: style.buttonFill,
                   glyph: style.buttonGlyph)
    }
  }
  // @ai-end

  private func arabic(_ ayah: StaticAyah, size: CGFloat, lines: Int) -> some View {
    Text(ayah.arabic)
      .font(WidgetFonts.quran(size))
      .multilineTextAlignment(.center)
      .lineLimit(lines)
      // Long ayat still have to fit whole: scale down rather than truncate. // @ai
      .minimumScaleFactor(0.4)
      .frame(maxWidth: .infinity)
      .environment(\.layoutDirection, .rightToLeft)
  }
}

#Preview("Small", as: .systemSmall) {
  AyahOfTheDayWidget()
} timeline: {
  AyahOfTheDayEntry(date: .now, ayah: StaticData.ayat.first { $0.key == "94:6" })
}

#Preview("Medium", as: .systemMedium) {
  AyahOfTheDayWidget()
} timeline: {
  AyahOfTheDayEntry(date: .now, ayah: StaticData.ayat.first { $0.key == "2:152" })
}

#Preview("Large", as: .systemLarge) {
  AyahOfTheDayWidget()
} timeline: {
  AyahOfTheDayEntry(date: .now, ayah: StaticData.ayat.first { $0.key == "39:53" })
  AyahOfTheDayEntry(date: .now, ayah: nil)
}
