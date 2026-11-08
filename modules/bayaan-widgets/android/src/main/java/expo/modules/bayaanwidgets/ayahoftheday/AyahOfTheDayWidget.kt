// ayahoftheday/AyahOfTheDayWidget.kt
package expo.modules.bayaanwidgets.ayahoftheday

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.state.GlanceStateDefinition
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import expo.modules.bayaanwidgets.ArabicBitmap
import expo.modules.bayaanwidgets.GlanceState
import expo.modules.bayaanwidgets.R
import expo.modules.bayaanwidgets.StaticAyah
import expo.modules.bayaanwidgets.StaticData
import expo.modules.bayaanwidgets.WidgetLanguage
import expo.modules.bayaanwidgets.WidgetText
import expo.modules.bayaanwidgets.ui.ArabicText
import expo.modules.bayaanwidgets.PlaybackState
import expo.modules.bayaanwidgets.SnapshotModels
import expo.modules.bayaanwidgets.WidgetTrack
import expo.modules.bayaanwidgets.ui.Eyebrow
import expo.modules.bayaanwidgets.ui.PrimaryButton
import expo.modules.bayaanwidgets.ui.ReadingColors
import expo.modules.bayaanwidgets.ui.isNightMode
import expo.modules.bayaanwidgets.ui.playOrPause
import expo.modules.bayaanwidgets.ui.playingTrack
import androidx.glance.text.TextAlign
import expo.modules.bayaanwidgets.ui.RoundButton
import expo.modules.bayaanwidgets.ui.WidgetColors
import expo.modules.bayaanwidgets.ui.WidgetSizes
import expo.modules.bayaanwidgets.ui.commandAction
import expo.modules.bayaanwidgets.ui.appLink
import expo.modules.bayaanwidgets.ui.playTrackCommand
import java.util.TimeZone

class AyahOfTheDayWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(WidgetSizes.SMALL, SMALL_TALL, WidgetSizes.MEDIUM, MEDIUM_TALL, WidgetSizes.LARGE))
  override val stateDefinition: GlanceStateDefinition<*> = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val stored = GlanceState.stored(context, GlanceState.appWidgetId(context, id))
    provideContent {
      // Read state so a midnight push recomposes; the ayah itself depends only on today's date.
      val inputs = GlanceState.current(currentState(), stored) // @ai
      val snapshot = remember(inputs.snapshotJson) { inputs.snapshotJson?.let { SnapshotModels.decode(it) } }
      val playing = playingTrack(context, snapshot) // @ai
      // @ai Qariah (TECH_DEBT #357): the text follows the app language.
      val language = WidgetLanguage.resolve(context, snapshot?.language)
      val strings = remember(language) { WidgetLanguage.context(context, language) }
      Content(context, strings, language, StaticData.ayahOfTheDay(context, System.currentTimeMillis(), TimeZone.getDefault()), playing) // @ai
    }
  }

  // @ai-start
  @Composable
  private fun Content(context: Context, strings: Context, language: String?, ayah: StaticAyah?, playing: WidgetTrack?) {
    val size = LocalSize.current
    val root = GlanceModifier.fillMaxSize().background(ReadingColors.BACKGROUND).cornerRadius(20.dp)
    if (ayah == null) {
      Box(root, contentAlignment = Alignment.Center) {
        Text(strings.getString(R.string.bayaan_widget_text_open_app, WidgetLanguage.appName(strings)), style = TextStyle(color = ReadingColors.PRIMARY, fontWeight = FontWeight.Medium))
      }
      return
    }
    val open = appLink(context, "quran/${ayah.surahId}?ayah=${ayah.ayah}")
    // The ayah's surah is playing, from any reciter.
    val isPlaying = PlaybackState.matches(playing, ayah.surahId, null)
    val listen = playOrPause(context, isPlaying, commandAction(context, playTrackCommand(ayah.surahId, null, null, ayah.ayah), "ayah/${ayah.key}"))
    val ink = if (isNightMode(context)) 0xFFF4F3EC.toInt() else 0xFF06151C.toInt()
    val width = size.width.value
    // @ai Qariah (TECH_DEBT #357): readers of Arabic see no English translation, as in the app.
    val showTranslation = !WidgetLanguage.arabicContent(language)
    val reference = reference(context, strings, language, ayah)
    val listenLabel = strings.getString(R.string.bayaan_widget_text_listen)
    val pauseLabel = strings.getString(R.string.bayaan_widget_text_pause)
    when {
      size.height >= WidgetSizes.LARGE.height -> Column(root.padding(20.dp).clickable(open), horizontalAlignment = Alignment.CenterHorizontally) {
        Eyebrow(strings.getString(R.string.bayaan_widget_ayah_label), ReadingColors.LABEL) // @ai Qariah (TECH_DEBT #357)
        Spacer(GlanceModifier.defaultWeight())
        ArabicText(context, ayah.arabic, ArabicBitmap.QURAN_FONT, width - 40, 110f, 28f, 14f, 4, center = true, color = ink, wholeLines = true)
        if (showTranslation) { // @ai Qariah (TECH_DEBT #357)
          Spacer(GlanceModifier.height(10.dp))
          Text(ayah.translation, maxLines = 3, style = TextStyle(color = ReadingColors.SECONDARY, fontSize = 13.sp, textAlign = TextAlign.Center))
        }
        Spacer(GlanceModifier.defaultWeight())
        Footer(reference, listenLabel, pauseLabel, isPlaying, listen, 38) // @ai Qariah (TECH_DEBT #357)
      }
      size.width >= WidgetSizes.MEDIUM.width -> Column(root.padding(14.dp).clickable(open)) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          // @ai Qariah (TECH_DEBT #357): the text, the names and the digits in the app language.
          Eyebrow(strings.getString(R.string.bayaan_widget_text_ayah_reference, reference), ReadingColors.LABEL)
          Spacer(GlanceModifier.defaultWeight())
          PrimaryButton(isPlaying, listenLabel, listen, sizeDp = 30, fill = ReadingColors.BUTTON, glyph = ReadingColors.BUTTON_GLYPH,
            pauseDescription = pauseLabel)
        }
        Spacer(GlanceModifier.height(4.dp))
        // The 110 dp bucket gives the ayah everything below the header; the TALL buckets add the translation.
        val short = WidgetSizes.isShort(size)
        // @ai Qariah (TECH_DEBT #357): without the translation, the ayah gets its room.
        val chrome = when {
          short -> SHORT_CHROME_DP
          showTranslation -> MEDIUM_CHROME_DP
          else -> MEDIUM_CHROME_DP - MEDIUM_TRANSLATION_DP
        }
        val arabicHeight = size.height.value - chrome
        ArabicText(context, ayah.arabic, ArabicBitmap.QURAN_FONT, width - 28, arabicHeight, 24f, 11f, 3, center = true, color = ink,
          wholeLines = true)
        if (!short && showTranslation) { // @ai Qariah (TECH_DEBT #357)
          Spacer(GlanceModifier.height(4.dp))
          Text(ayah.translation, maxLines = 2, style = TextStyle(color = ReadingColors.SECONDARY, fontSize = 12.sp, textAlign = TextAlign.Center),
            modifier = GlanceModifier.fillMaxWidth())
        }
      }
      else -> Column(root.padding(12.dp).clickable(open), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(GlanceModifier.defaultWeight())
        ArabicText(context, ayah.arabic, ArabicBitmap.QURAN_FONT, width - 24, size.height.value - 24 - 40, 26f, 10f, 5, center = true, color = ink)
        Spacer(GlanceModifier.defaultWeight())
        SmallFooter(surahName(context, language, ayah), verseKey(strings, ayah), listenLabel, pauseLabel, isPlaying, listen) // @ai Qariah
      }
    }
  }

  /** The surah name in the app language. */ // @ai Qariah (TECH_DEBT #357)
  private fun surahName(context: Context, language: String?, ayah: StaticAyah): String =
    StaticData.surah(context, ayah.surahId)?.let { WidgetLanguage.surahName(it, language) } ?: ayah.surahName

  /** "11:6" in the digits of the app language. */ // @ai Qariah (TECH_DEBT #357)
  private fun verseKey(strings: Context, ayah: StaticAyah): String =
    "${WidgetLanguage.number(strings, ayah.surahId)}:${WidgetLanguage.number(strings, ayah.ayah)}"

  /** "Hud 11:6": the surah name and the verse key, in the app language and its digits. */ // @ai Qariah (TECH_DEBT #357)
  private fun reference(context: Context, strings: Context, language: String?, ayah: StaticAyah): String =
    WidgetText.reference(surahName(context, language, ayah), verseKey(strings, ayah))

  /** Reference on the left, listen button on the right. */
  @Composable
  private fun Footer(reference: String, listenLabel: String, pauseLabel: String, isPlaying: Boolean, listen: Action, buttonDp: Int) {
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(reference, maxLines = 1, modifier = GlanceModifier.defaultWeight(), // @ai Qariah (TECH_DEBT #357)
        style = TextStyle(color = ReadingColors.LABEL, fontSize = 11.sp, fontWeight = FontWeight.Bold))
      PrimaryButton(isPlaying, listenLabel, listen, sizeDp = buttonDp, fill = ReadingColors.BUTTON, glyph = ReadingColors.BUTTON_GLYPH,
        pauseDescription = pauseLabel)
    }
  }

  /** Surah over the ayah number, so a 110 dp cell never cuts the reference. */
  // @ai Qariah (TECH_DEBT #357): the name, the digits and the descriptions in the app language.
  @Composable
  private fun SmallFooter(
    surahName: String, verseKey: String, listenLabel: String, pauseLabel: String, isPlaying: Boolean, listen: Action,
  ) {
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(GlanceModifier.defaultWeight()) {
        Text(WidgetText.shortSurahName(surahName, 9), maxLines = 1,
          style = TextStyle(color = ReadingColors.LABEL, fontSize = 10.sp, fontWeight = FontWeight.Medium))
        Text(verseKey, maxLines = 1, style = TextStyle(color = ReadingColors.LABEL, fontSize = 11.sp, fontWeight = FontWeight.Bold))
      }
      PrimaryButton(isPlaying, listenLabel, listen, sizeDp = 28, fill = ReadingColors.BUTTON, glyph = ReadingColors.BUTTON_GLYPH,
        pauseDescription = pauseLabel)
    }
  }
  // @ai-end

  private companion object {
    val SMALL_TALL = DpSize(110.dp, 180.dp)
    val MEDIUM_TALL = DpSize(250.dp, 180.dp)
    /** Padding, header, spacers and a two-line translation around the medium ayah. */
    const val MEDIUM_CHROME_DP = 104f
    /** Padding, the header row and its gap around the 110 dp medium ayah. */ // @ai
    const val SHORT_CHROME_DP = 64f // @ai
    /** The two-line translation and its spacer, left out for readers of Arabic. */ // @ai Qariah (TECH_DEBT #357)
    const val MEDIUM_TRANSLATION_DP = 36f
  }
}
