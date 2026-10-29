package expo.modules.bayaanwidgets

import org.junit.Assert.*
import org.junit.Test
import java.io.File

// @ai Qariah (TECH_DEBT #357)
class WidgetLanguageTest {
  // A stand-in for the Arabic name; the bundled data test below reads the real one.
  private val kahf = StaticSurah(18, "Al-Kahf", "The Cave", "", "surah-18.jpg", nameArabic = "<arabic name of 18>")

  @Test fun readsThePrimaryLanguageSubtag() {
    assertEquals("ar", WidgetLanguage.code("ar"))
    assertEquals("ar", WidgetLanguage.code("ar-EG"))
    assertEquals("en", WidgetLanguage.code(" EN_us "))
    assertNull(WidgetLanguage.code(null))
    assertNull(WidgetLanguage.code(""))
  }

  @Test fun arabicContentOnlyForArabic() {
    assertTrue(WidgetLanguage.arabicContent("ar"))
    assertTrue(WidgetLanguage.arabicContent("ar-SA"))
    assertFalse(WidgetLanguage.arabicContent("en"))
    // No language (an older app build): the English names, as before.
    assertFalse(WidgetLanguage.arabicContent(null))
  }

  @Test fun surahNameFollowsTheLanguage() {
    assertEquals("<arabic name of 18>", WidgetLanguage.surahName(kahf, "ar"))
    assertEquals("Al-Kahf", WidgetLanguage.surahName(kahf, "en"))
    assertEquals("Al-Kahf", WidgetLanguage.surahName(kahf, null))
    assertEquals("Al-Kahf", WidgetLanguage.surahName(kahf.copy(nameArabic = null), "ar"))
  }

  @Test fun bundledSurahsCarryTheArabicName() {
    val surahs = StaticData.parseSurahs(File("src/main/assets/widgets/surahs.json").readText())
    assertEquals(114, surahs.size)
    assertTrue(surahs.all { !it.nameArabic.isNullOrEmpty() && it.nameArabic != it.name })
    assertEquals(surahs[17].nameArabic, WidgetLanguage.surahName(surahs[17], "ar"))
  }
}
