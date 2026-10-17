package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.ReviewStatus
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Ported from prototype-expo/src/content/__tests__/gating.test.ts plus the P0 header tests. */
class PackValidatorTest {
    private val validMeta =
        PackMeta(
            schemaVersion = 1,
            contentVersion = "2026.10.0",
            subject = Subject.MATEMATIKA,
            track = "mat",
            mode = TrackMode.CASUAL,
            audiences = listOf(Audience.KIDS, Audience.ADULTS),
            instructionLangs = listOf(Lang.ID, Lang.EN),
            title = LocalizedText(id = "Matematika", en = "Mathematics"),
        )

    @Test
    fun `a complete header has no problems`() {
        assertTrue(PackValidator.validateMeta(validMeta).isEmpty())
    }

    @Test
    fun `a title missing a declared language is a problem`() {
        val problems = PackValidator.validateMeta(validMeta.copy(title = LocalizedText(id = "Matematika", en = "")))
        assertEquals(listOf("title"), problems.map { it.path })
    }

    @Test
    fun `header round-trips through JSON with snake_case keys`() {
        val json = Json { prettyPrint = false }
        val text = json.encodeToString(PackMeta.serializer(), validMeta)
        assertTrue("\"content_version\"" in text && "\"instruction_langs\"" in text && "\"casual\"" in text)
        assertEquals(validMeta, json.decodeFromString(PackMeta.serializer(), text))
    }

    // ---- bundled packs -------------------------------------------------------------------------

    @Test
    fun `the Arabic demo fixture is valid`() {
        assertEquals(emptyList(), PackValidator.validate(Fixtures.arabic()))
    }

    @Test
    fun `the math sample pack is valid in both languages`() {
        val pack = Fixtures.math()
        assertEquals(emptyList(), PackValidator.validate(pack))
        assertEquals(listOf(Lang.ID, Lang.EN), pack.meta.instructionLangs)
        assertEquals(12, pack.items.size)
    }

    @Test
    fun `every demo item is draft and synthetic (nothing auto-approved)`() {
        val pack = Fixtures.arabic()
        assertTrue(pack.synthetic)
        assertTrue(pack.items.all { it.reviewStatus == ReviewStatus.DRAFT })
        assertTrue(pack.items.all { it.itemId.startsWith("DEMO-") })
    }

    @Test
    fun `rejects Arabic stripped of vowel marks`() {
        val pack = Fixtures.arabic()
        val bare = pack.copy(items = pack.items.mapIndexed { i, it -> if (i == 0) it.copy(targetText = "صادق") else it })
        assertTrue(PackValidator.validate(bare).any { "harakat" in it.message })
    }

    @Test
    fun `rejects duplicate ids and choice items without exactly one correct option`() {
        val pack = Fixtures.arabic()
        val items = pack.items.toMutableList()
        items[1] = items[1].copy(itemId = items[0].itemId)
        items[2] = items[4].copy(itemId = "DEMO-X", options = items[4].options.map { it.copy(correct = false) })
        val messages = PackValidator.validate(pack.copy(items = items)).joinToString("\n")
        assertTrue("duplicate" in messages)
        assertTrue("exactly one correct" in messages)
    }

    @Test
    fun `rejects unknown prompt and feedback ids`() {
        val pack = Fixtures.arabic()
        val first = pack.items[0].copy(promptId = "NOPE", feedbackIds = pack.items[0].feedbackIds + ("correct" to "NOPE-FB"))
        val messages = PackValidator.validate(pack.copy(items = listOf(first) + pack.items.drop(1))).joinToString("\n")
        assertTrue("prompt_id NOPE" in messages)
        assertTrue("NOPE-FB" in messages)
    }

    @Test
    fun `a learner-facing string missing one declared language fails (CR-I18N-5)`() {
        val pack = Fixtures.math()
        val broken = pack.copy(prompts = pack.prompts + ("P-COUNT" to LocalizedText(id = "Ada berapa?", en = "")))
        assertEquals(listOf("prompts.P-COUNT"), PackValidator.validate(broken).map { it.path })
    }

    @Test
    fun `a gem without a source is rejected (framework 1b)`() {
        val pack = Fixtures.math()
        val items = pack.items.map { if (it.gem) it.copy(source = null) else it }
        assertTrue(PackValidator.validate(pack.copy(items = items)).any { "source" in it.message })
    }

    @Test
    fun `a typed item needs accepted terms for every declared language`() {
        val pack = Fixtures.arabic()
        val en = pack.copy(meta = pack.meta.copy(instructionLangs = listOf(Lang.ID, Lang.EN)))
        val problems = PackValidator.validate(en)
        // The demo pack is id-only on purpose; declaring en must surface the missing accepted terms.
        assertTrue(problems.any { "accepted terms for en" in it.message })
    }

    // ---- gating -----------------------------------------------------------------------------------

    @Test
    fun `demo mode shows the draft synthetic fixture, labelled as unreviewed`() {
        val pack = Fixtures.arabic()
        val g = Gating.gate(pack, developerDemo = true)
        assertEquals(pack.items.size, g.items.size)
        assertEquals(pack.screens.size, g.screens.size)
        assertTrue(g.unreviewed)
        assertTrue(!g.empty)
    }

    @Test
    fun `prod mode hides all draft content and reports an explicit empty state`() {
        val g = Gating.gate(Fixtures.arabic(), developerDemo = false)
        assertTrue(g.items.isEmpty() && g.screens.isEmpty() && g.empty)
    }

    @Test
    fun `prod mode never shows synthetic content, even if an item claims approval`() {
        val pack = Fixtures.arabic()
        val approved =
            pack.copy(
                items = pack.items.map { it.copy(reviewStatus = ReviewStatus.APPROVED) },
                screens = pack.screens.map { it.copy(reviewStatus = ReviewStatus.APPROVED) },
            )
        assertTrue(Gating.gate(approved, developerDemo = false).empty)
    }

    @Test
    fun `prod mode shows only approved items of a non-synthetic pack`() {
        val pack = Fixtures.arabic()
        val items = pack.items.toMutableList()
        items[0] = items[0].copy(reviewStatus = ReviewStatus.APPROVED)
        items[1] = items[1].copy(reviewStatus = ReviewStatus.REVIEWED_SUBJECT)
        val screens = pack.screens.toMutableList()
        screens[0] = screens[0].copy(reviewStatus = ReviewStatus.APPROVED)
        val g = Gating.gate(pack.copy(synthetic = false, items = items, screens = screens), developerDemo = false)
        assertEquals(listOf(items[0].itemId), g.items.map { it.itemId })
        assertEquals(listOf(screens[0].screenId), g.screens.map { it.screenId })
        assertTrue(!g.unreviewed)
    }

    @Test
    fun `gating never changes review_status`() {
        val pack = Fixtures.arabic()
        val before = PackLoader.encode(pack)
        Gating.gate(pack, developerDemo = false)
        Gating.gate(pack, developerDemo = true)
        assertEquals(before, PackLoader.encode(pack))
    }
}
