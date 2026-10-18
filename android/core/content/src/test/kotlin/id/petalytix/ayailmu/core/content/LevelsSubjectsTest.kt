package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Follow-up 12: the Nilai and Sejarah modules and the pack level (docs/content/MODULES_LEVELS_STORIES.md section 1). */
class LevelsSubjectsTest {
    private fun header(
        subject: String,
        level: String? = null,
    ): String {
        val lv = if (level == null) "" else "\"level\": \"$level\", "
        return """
            {"meta": {"schema_version": 1, "content_version": "x-0.1", "subject": "$subject", "track": "x", $lv
              "mode": "casual", "audiences": ["kids"], "instruction_langs": ["id", "en"],
              "title": {"id": "X", "en": "X"}}}
        """.trimIndent()
    }

    @Test
    fun `nilai and sejarah decode with their codes`() {
        assertEquals(Subject.NILAI, PackLoader.parse(header("nilai")).meta.subject)
        assertEquals(Subject.SEJARAH, PackLoader.parse(header("sejarah")).meta.subject)
        assertEquals("NIL", Subject.NILAI.code)
        assertEquals("SJR", Subject.SEJARAH.code)
        assertEquals(6, Subject.entries.size)
    }

    @Test
    fun `a pack without a level is Pemula and re-encodes without one`() {
        val pack = PackLoader.parse(header("matematika"))
        assertEquals(Level.PEMULA, pack.meta.level)
        assertFalse("\"level\"" in PackLoader.encode(pack))
    }

    @Test
    fun `every level decodes from the meta`() {
        val expected = mapOf("pemula" to Level.PEMULA, "menengah" to Level.MENENGAH, "mahir" to Level.MAHIR, "master" to Level.MASTER)
        expected.forEach { (name, level) -> assertEquals(level, PackLoader.parse(header("sejarah", name)).meta.level, name) }
        val master = PackLoader.parse(header("nilai", "master"))
        assertTrue("\"level\":\"master\"" in PackLoader.encode(master))
    }

    @Test
    fun `the bundled and fixture packs are all Pemula and stay valid`() {
        for (pack in listOf(Fixtures.math(), Fixtures.arabic(), Fixtures.load("fixtures/lang-sample-v1.json"))) {
            assertEquals(Level.PEMULA, pack.meta.level, pack.meta.track)
            assertEquals(emptyList(), PackValidator.validate(pack), pack.meta.track)
        }
    }

    @Test
    fun `an item level must match the pack level`() {
        val sample = Fixtures.load("fixtures/story-sample-v1.json")
        assertEquals(Level.MENENGAH, sample.meta.level)
        assertEquals(emptyList(), PackValidator.validate(sample))

        val math = Fixtures.math()
        val first = math.items.first()
        assertEquals(Level.PEMULA, first.level)
        val items = math.items.map { if (it.itemId == first.itemId) it.copy(level = Level.MAHIR) else it }
        val problems = PackValidator.validate(math.copy(items = items))
        assertEquals(listOf(first.itemId), problems.map { it.path })
        assertEquals("level mahir does not match the pack level pemula", problems.single().message)

        // Raising the pack level makes every Pemula item a problem; items without a level are fine.
        val raised = math.copy(meta = math.meta.copy(level = Level.MENENGAH))
        assertEquals(math.items.count { it.level != null }, PackValidator.validate(raised).size)
        val unlevelled = raised.copy(items = raised.items.map { it.copy(level = null) })
        assertEquals(emptyList(), PackValidator.validate(unlevelled))
    }
}
