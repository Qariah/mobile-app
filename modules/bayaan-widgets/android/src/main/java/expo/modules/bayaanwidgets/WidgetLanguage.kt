package expo.modules.bayaanwidgets

import android.content.Context
import android.content.res.Configuration
import java.text.NumberFormat
import java.util.Locale

// @ai Qariah (TECH_DEBT #357)
/**
 * Widget text in the app's UI language, not the device language. The app
 * writes its language into the snapshot (`language`), so a person who picks
 * Arabic in the app on an English phone also gets Arabic widgets. A snapshot
 * with no language (the app keeps "System default", or an older app build)
 * makes the widgets follow the device language, also right after a change of
 * it. Mirrored by WidgetLanguage.swift.
 */
object WidgetLanguage {
  /**
   * Languages whose readers see Arabic surah names and no English ayah
   * translation in the app (`bilingualContent` and `understandsArabic` in
   * i18n/languages.ts).
   */
  private val ARABIC_CONTENT = setOf("ar")

  /** The primary language subtag ("ar" for "ar-EG"), or null. */
  fun code(language: String?): String? =
    language?.trim()?.substringBefore('-')?.substringBefore('_')?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() }

  /** [language], or the device language when the snapshot has none. */
  fun resolve(context: Context, language: String?): String? =
    code(language) ?: code(context.resources.configuration.locales[0]?.language)

  fun arabicContent(language: String?): Boolean = code(language) in ARABIC_CONTENT

  /** The surah name a widget shows in [language]: the Arabic name for Arabic content. */
  fun surahName(surah: StaticSurah, language: String?): String =
    if (arabicContent(language)) surah.nameArabic ?: surah.name else surah.name

  /**
   * [context] with its resources (strings, number formats) in [language].
   * Returns [context] itself when there is no language or it already matches.
   */
  fun context(context: Context, language: String?): Context {
    val code = code(language) ?: return context
    val config = Configuration(context.resources.configuration)
    if (config.locales[0]?.language == code) return context
    config.setLocale(Locale.forLanguageTag(code))
    return context.createConfigurationContext(config)
  }

  /** A whole number in the digits of [context]'s language (Arabic-Indic for Arabic). */
  fun number(context: Context, value: Int): String =
    NumberFormat.getIntegerInstance(context.resources.configuration.locales[0])
      .apply { isGroupingUsed = false }
      .format(value.toLong())

  /** The app name in [context]'s language: the label resource (app_name), else the label the system shows. */
  fun appName(context: Context): String {
    val labelRes = context.applicationInfo.labelRes
    val label = if (labelRes != 0) runCatching { context.getString(labelRes) }.getOrNull() else null
    return AppBrand.name(label ?: context.applicationInfo.loadLabel(context.packageManager))
  }
}
