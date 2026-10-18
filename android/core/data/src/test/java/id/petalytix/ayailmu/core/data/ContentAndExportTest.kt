package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.export.ExportBuilder
import id.petalytix.ayailmu.core.data.repo.AppConfigRepository
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
import id.petalytix.ayailmu.core.model.Subject
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
    fun `the catalog loads every bundled track with no validation problems`() =
        runTest {
            val repo = ContentRepository(TestSupport.classpathAssets, AppBuildInfo(developerDemo = true, appVersion = "0.2.0"))
            val tracks = repo.tracks()
            // Follow-up 11 added the eight language tracks (English, Korean, Japanese, Mandarin; kids and adults);
            // follow-up 12 the Menengah/Mahir/Master tracks of every module plus Nilai and Sejarah (73 in all).
            val languages = listOf("ing-k", "ing-a", "kor-k", "kor-a", "jpn-k", "jpn-a", "zho-k", "zho-a")
            val ids = tracks.map { it.track }
            assertEquals(listOf("arab", "mat", "mat-a", "sns-k", "sns-a", "sos-k", "sos-a") + languages, ids.take(15))
            assertEquals(73, tracks.size)
            assertEquals(ids.size, ids.distinct().size)
            assertTrue(tracks.all { it.problems.isEmpty() }, tracks.flatMap { it.problems }.joinToString())
            assertEquals(17, tracks[0].content.items.size)
            assertTrue(tracks.all { it.content.items.isNotEmpty() })
            // Free tier (MONETIZATION_SCHEME): Arabic Unit A, unit 01 everywhere else; Nilai is free (every unit listed).
            assertEquals(listOf("A"), tracks[0].freeUnits)
            val (nilai, paid) = tracks.drop(1).partition { it.pack.meta.subject == Subject.NILAI }
            assertEquals(8, nilai.size)
            assertTrue(paid.all { it.freeUnits == listOf("01") })
            assertTrue(nilai.all { t -> t.freeUnits == t.pack.units.map { it.unit } && t.freeUnits.isNotEmpty() })
        }

    @Test
    fun `the bundled app config has a valid trial block`() =
        runTest {
            val trial = AppConfigRepository(TestSupport.classpathAssets).trial()
            assertEquals("arab", trial.track)
            assertEquals(7, trial.surveyDay)
            assertEquals(emptyList(), trial.problems())
            // Only hashes ship: anything that is not 64 lowercase hex digits is refused.
            val bad = trial.copy(surveyDay = 0, endSurveyFrom = "soon", testerCodeHashes = listOf("AYA-ABCD-EFGH"), testerUntil = null)
            // ...and hashes without an end date are refused too (a leaked code must not open the packs for ever).
            assertEquals(4, bad.problems().size)
            assertEquals(1, trial.copy(testerUntil = "later").problems().size)
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
    fun `export JSON carries trial surveys and finished unit challenges (P7)`() {
        val survey = SurveyRecord("srv-1", "lrn-1", "arab", "day7", "2026-10-22T02:00:00Z", "0.2.0", mapOf("clarity" to listOf("4"), "continue" to listOf("yes")))
        val challenge = UnitChallenge("chl-1", "lrn-1", "mat", "01", "2026-10-22T02:30:00Z")
        val b = ExportBuilder.build(listOf(profile), emptyList(), emptyList(), "2026-10-22T03:00:00Z", "0.2.0", listOf(survey), listOf(challenge))
        assertTrue("\"schema_version\": 2" in b.json)
        assertTrue("\"kind\": \"day7\"" in b.json)
        assertTrue("\"unit_challenges\"" in b.json)
        assertTrue("\"completed_at\": \"2026-10-22T02:30:00Z\"" in b.json)
    }

    @Test
    fun `export CSV has a BOM, the header, one row per event and safe quoting`() {
        val csv = ExportBuilder.csv(listOf(event("""{"kind":"typed","text":"=HYPERLINK(\"x\"), ok"}""")))
        assertTrue(csv.startsWith("﻿"))
        val lines = csv.removePrefix("﻿").trimEnd().split("\r\n")
        assertEquals(2, lines.size)
        assertEquals(ExportBuilder.CSV_COLUMNS.joinToString(","), lines[0])
        assertTrue(lines[1].contains("LEX-A:W-A3|NOM-01"))
        assertTrue(lines[1].endsWith("\"{\"\"kind\"\":\"\"typed\"\",\"\"text\"\":\"\"=HYPERLINK(\\\"\"x\\\"\"), ok\"\"}\",false"))
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
