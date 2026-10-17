package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.export.ExportBuilder
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.settings.AppSettings
import id.petalytix.ayailmu.core.data.settings.AppSettingsSerializer
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.PartScore
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.ReviewStatus
import kotlinx.coroutines.test.runTest
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Pure-JVM P2 tests: catalog loading, export format, settings serializer. */
class ContentAndExportTest {
    @Test
    fun `the catalog loads both bundled tracks with no validation problems`() =
        runTest {
            val repo = ContentRepository(TestSupport.classpathAssets, AppBuildInfo(developerDemo = true, appVersion = "0.2.0"))
            val tracks = repo.tracks()
            assertEquals(listOf("arab", "mat"), tracks.map { it.track })
            assertTrue(tracks.all { it.problems.isEmpty() }, tracks.flatMap { it.problems }.joinToString())
            assertEquals(17, tracks[0].content.items.size)
            assertEquals(12, tracks[1].content.items.size)
        }

    @Test
    fun `prod builds see no synthetic content`() =
        runTest {
            val repo = ContentRepository(TestSupport.classpathAssets, AppBuildInfo(developerDemo = false, appVersion = "0.2.0"))
            assertTrue(repo.tracks().all { it.content.empty })
        }

    private fun event(raw: String) =
        AnswerEvent(
            answerId = "ans-1", learnerId = "lrn-1", itemId = "DEMO-M01", track = "arab", contentVersion = "demo-synthetic-0.1",
            rulesVersion = "pilot-0.1", appVersion = "0.2.0", timestamp = "2026-10-15T02:00:00Z", localDate = "2026-10-15",
            sessionId = "ses-1", lang = Lang.ID, pool = Pool.PRACT, unit = "A", skills = listOf("LEX-A:W-A3", "NOM-01"),
            rawResponse = raw, autoScore = mapOf("meaning" to PartScore.CORRECT), outcome = Outcome.CORRECT,
            firstAttempt = true, freshEvidence = true, reviewStatus = ReviewStatus.DRAFT, itemType = ItemType.TYPE_IN,
        )

    private val profile =
        Profile(
            id = "lrn-1", label = "Secret Nickname", kind = ProfileKind.ADULT, createdBy = null, birthYear = 1990,
            audience = Audience.ADULTS, lang = Lang.ID, createdAtMs = 0, sessionMinutes = null, arabicScale = 1f,
            screensSeen = emptyList(), consentVersion = null,
        )

    @Test
    fun `export JSON carries events and profiles without label or birth year (CR-DAT-2)`() {
        val b = ExportBuilder.build(listOf(profile), listOf(event("""{"kind":"typed","text":"jujur"}""")), emptyList(), "2026-10-15T03:00:00Z", "0.2.0")
        assertTrue("\"answer_id\": \"ans-1\"" in b.json)
        assertFalse("Secret Nickname" in b.json)
        assertFalse("1990" in b.json)
    }

    @Test
    fun `export CSV has a BOM, the header, one row per event and safe quoting`() {
        val csv = ExportBuilder.csv(listOf(event("""{"kind":"typed","text":"=HYPERLINK(\"x\"), ok"}""")))
        assertTrue(csv.startsWith("﻿"))
        val lines = csv.removePrefix("﻿").trimEnd().split("\r\n")
        assertEquals(2, lines.size)
        assertEquals(ExportBuilder.CSV_COLUMNS.joinToString(","), lines[0])
        assertTrue(lines[1].contains("LEX-A:W-A3|NOM-01"))
        assertTrue(lines[1].endsWith("\"{\"\"kind\"\":\"\"typed\"\",\"\"text\"\":\"\"=HYPERLINK(\\\"\"x\\\"\"), ok\"\"}\""))
    }

    @Test
    fun `a cell that looks like a formula is neutralised`() {
        assertEquals("'=1+1", ExportBuilder.cell("=1+1"))
        assertEquals("\"'=1,2\"", ExportBuilder.cell("=1,2"))
        assertEquals("plain", ExportBuilder.cell("plain"))
    }

    @Test
    fun `settings round-trip through the DataStore serializer`() =
        runTest {
            val out = ByteArrayOutputStream()
            AppSettingsSerializer.writeTo(AppSettings(activeProfileId = "lrn-9"), out)
            val back = AppSettingsSerializer.readFrom(ByteArrayInputStream(out.toByteArray()))
            assertEquals("lrn-9", back.activeProfileId)
        }
}
