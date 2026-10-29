package expo.modules.bayaanwidgets

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class SnapshotModelsTest {
  private fun fixture(name: String) =
    File("../src/__fixtures__/$name").readText()

  @Test fun decodesFullFixture() {
    val s = SnapshotModels.decode(fixture("snapshot.full.json"))
    assertNotNull(s)
    assertEquals(18, s!!.nowPlaying!!.track.surahId)
    assertEquals(1.0, s.nowPlaying!!.rate, 0.0)
    assertEquals(15, s.lastRead!!.juz)
    assertEquals(12, s.tasbeeh["tasbeeh-subhanallah"]!!.count)
  }

  @Test fun decodesEmptyFixture() {
    val s = SnapshotModels.decode(fixture("snapshot.empty.json"))
    assertNotNull(s)
    assertNull(s!!.nowPlaying)
  }

  // @ai Qariah (TECH_DEBT #357)
  @Test fun decodesTheAppLanguage() {
    val withLanguage = fixture("snapshot.full.json").replace("\"tasbeeh\": {", "\"language\": \"ar\",\n  \"tasbeeh\": {")
    assertEquals("ar", SnapshotModels.decode(withLanguage)!!.language)
    // A snapshot from an older app build has none.
    assertNull(SnapshotModels.decode(fixture("snapshot.full.json"))!!.language)
  }

  @Test fun rejectsFutureVersionAndGarbage() {
    assertNull(SnapshotModels.decode(fixture("snapshot.full.json").replace("\"version\": 1", "\"version\": 2")))
    assertNull(SnapshotModels.decode("nope"))
  }
}
