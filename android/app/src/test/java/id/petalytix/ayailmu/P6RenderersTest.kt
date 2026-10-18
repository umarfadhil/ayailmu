package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.Gestures
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.content.StrokeIndex
import id.petalytix.ayailmu.core.design.art.ArtRegistry
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.MemoryCardUi
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.SliderUi
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import id.petalytix.ayailmu.feature.session.interact.TraceMatcher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** P6 renderers on the real bundled packs, and the P4 art registry against the art index (both directions). */
class P6RenderersTest {
    private val tracks = TestPacks.catalog

    private fun question(
        track: String,
        itemId: String,
        lang: Lang = Lang.ID,
    ): StepUi.Question {
        val t = TestPacks.track(track)
        val item = t.content.item(itemId)
        return StepMapper.question(item, Step.Role.PRACTICE, t.content, lang, t.pack.meta.targetLang)
    }

    @Test
    fun `every bundled item has a renderer, in both languages`() {
        tracks.forEach { t ->
            t.content.items.forEach { item ->
                assertTrue("${item.itemId} (${item.type}) has no renderer", StepMapper.kindOf(item) != RenderKind.UNSUPPORTED)
                Lang.entries.filter { it in t.pack.meta.instructionLangs }.forEach { lang -> question(t.track, item.itemId, lang) }
            }
        }
    }

    @Test
    fun `tap items carry their picture and a region for every option`() {
        val taps = tracks.flatMap { t -> t.content.items.filter { it.type == ItemType.TAP_HOTSPOT }.map { t.track to it.itemId } }
        assertTrue("no tap_hotspot items in the bundled packs", taps.isNotEmpty())
        taps.forEach { (track, id) ->
            val q = question(track, id)
            assertEquals(RenderKind.HOTSPOT, q.kind)
            assertNotNull(q.image)
            assertTrue(q.options.isNotEmpty() && q.options.all { it.region != null })
            q.options.forEach { o ->
                val r = o.region!!
                assertTrue("$id/${o.id} region outside the picture", r.x >= 0f && r.y >= 0f && r.x + r.w <= 1.0001f && r.y + r.h <= 1.0001f)
            }
        }
    }

    @Test
    fun `sliders carry a range that holds the answer`() {
        val sliders = tracks.flatMap { t -> t.content.items.filter { it.type == ItemType.ESTIMATE_SLIDER }.map { t.track to it } }
        assertTrue(sliders.isNotEmpty())
        sliders.forEach { (track, item) ->
            val q = question(track, item.itemId)
            assertEquals(RenderKind.SLIDER, q.kind)
            val spec = requireNotNull(q.slider)
            val value = requireNotNull(item.numeric).value
            assertTrue(item.itemId, value in spec.min..spec.max)
        }
    }

    @Test
    fun `memory cards hold both halves of every pair, in a stable order`() {
        val memory = tracks.flatMap { t -> t.content.items.filter { it.type == ItemType.MEMORY_FLIP }.map { t.track to it } }
        assertTrue(memory.isNotEmpty())
        memory.forEach { (track, item) ->
            val q = question(track, item.itemId)
            assertEquals(RenderKind.MEMORY, q.kind)
            assertEquals(item.solutionPairs.size * 2, q.cards.size)
            assertEquals(q.cards, question(track, item.itemId).cards)
            q.cards.groupBy { it.pairKey }.values.forEach { pair ->
                assertEquals(2, pair.size)
                assertEquals(1, pair.count { it.left })
            }
        }
    }

    @Test
    fun `picture options and question pictures use catalog keys`() {
        tracks.forEach { t ->
            t.content.items.forEach { item ->
                item.image?.let { assertNotNull("${item.itemId}: $it", ArtRegistry.drawable(it)) }
                item.options.mapNotNull { it.image }.forEach { assertNotNull("${item.itemId}: $it", ArtRegistry.drawable(it)) }
            }
            t.pack.units.mapNotNull { it.sticker }.forEach { assertNotNull("${t.track} sticker $it", ArtRegistry.drawable(it)) }
        }
    }

    @Test
    fun `the art registry matches the art index the validator reads`() {
        val stream = requireNotNull(javaClass.classLoader!!.getResourceAsStream("art/index.json"))
        val index = Json.parseToJsonElement(stream.use { it.readBytes().decodeToString() }).jsonObject
        val keys = requireNotNull(index["keys"]).jsonArray.map { it.jsonPrimitive.content }.toSet()
        assertEquals(keys, ArtRegistry.keys)
        // The keys the app itself draws (Aya, states, covers, glyphs, gems, the launcher draft).
        listOf(
            "aya_idle", "aya_wave", "aya_happy", "aya_think", "aya_sleep", "state_error", "state_seedling", "gem", "gem_box",
            "cover_bahasa", "cover_matematika", "cover_sains", "cover_sosial_seni", "glyph_correct", "glyph_not_yet", "glyph_saved",
            "app_icon_draft",
        ).forEach { assertTrue(it, it in ArtRegistry.keys) }
        assertTrue(requireNotNull(index["regions"]).jsonObject.containsKey("scene_kampung_shapes"))
        assertEquals(4f / 3f, ArtRegistry.aspect("scene_kampung_shapes"), 0.001f)
        assertEquals(1f, ArtRegistry.aspect("aya_idle"), 0.001f)
        assertNull(ArtRegistry.drawable("no_such_picture"))
    }

    @Test
    fun `sessions never serve daily puzzles or locked units`() {
        val mat = TestPacks.track("mat")
        val all = SessionContent.playable(mat.content)
        assertTrue(all.items.none { it.pool == Pool.SPARE })
        assertTrue(SessionContent.dailyPuzzles(mat.content).isNotEmpty())
        val free = SessionContent.playable(mat.content) { it == "01" }
        assertTrue(free.items.isNotEmpty() && free.items.all { it.unit == "01" })
        assertTrue(free.screens.all { it.unit == "01" })
        assertTrue(all.items.size > free.items.size)
    }

    // ---- answer drafts for the new renderers ----

    private fun memoryCards(): List<MemoryCardUi> {
        val l1 = OptionUi("n2", "2", null, null)
        val l2 = OptionUi("n5", "5", null, null)
        val r1 = OptionUi("w2", "dua", null, null)
        val r2 = OptionUi("w5", "lima", null, null)
        return listOf(
            MemoryCardUi("L-n2", l1, "n2", left = true),
            MemoryCardUi("R-w5", r2, "n5", left = false),
            MemoryCardUi("R-w2", r1, "n2", left = false),
            MemoryCardUi("L-n5", l2, "n5", left = true),
        )
    }

    private fun memoryQuestion(cards: List<MemoryCardUi>) =
        StepUi.Question(
            itemId = "M",
            kind = RenderKind.MEMORY,
            role = Step.Role.PRACTICE,
            prompt = "",
            target = null,
            help = emptyList(),
            left = cards.filter { it.left }.map { it.option },
            right = cards.filter { !it.left }.map { it.option },
            cards = cards,
        )

    @Test
    fun `memory - a miss stays visible until the next tap, a match stays for good`() {
        val cards = memoryCards()
        val q = memoryQuestion(cards)
        val d = AnswerDraft()
        d.flip(cards[0], cards) // 2
        d.flip(cards[1], cards) // lima: no match
        assertEquals(listOf("L-n2", "R-w5"), d.faceUp.toList())
        assertEquals(1, d.misses)
        assertNull(d.toResponse(q))
        d.flip(cards[2], cards) // dua: the miss turns back, dua is up
        assertEquals(listOf("R-w2"), d.faceUp.toList())
        d.flip(cards[0], cards) // 2 + dua match
        assertTrue(d.isFound(cards[0]) && d.isFound(cards[2]))
        assertTrue(d.faceUp.isEmpty())
        d.flip(cards[0], cards) // a found card ignores taps
        assertTrue(d.faceUp.isEmpty())
        d.flip(cards[3], cards)
        d.flip(cards[1], cards)
        assertEquals(
            Response.pairs(listOf(Response.Pairing("n2", "w2"), Response.Pairing("n5", "w5"))),
            d.toResponse(q),
        )
    }

    @Test
    fun `memory - two cards of the same side never match`() {
        val cards = memoryCards()
        val d = AnswerDraft()
        d.flip(cards[0], cards)
        d.flip(cards[3], cards)
        assertTrue(d.pairs.isEmpty())
        assertEquals(1, d.misses)
    }

    @Test
    fun `slider - nothing is sent until the learner moves it, and values snap to steps`() {
        val q =
            StepUi.Question(
                itemId = "S",
                kind = RenderKind.SLIDER,
                role = Step.Role.PRACTICE,
                prompt = "",
                target = null,
                help = emptyList(),
                slider = SliderUi(0.0, 20_000.0, 100.0),
            )
        val d = AnswerDraft()
        assertNull(d.toResponse(q))
        val spec = q.slider!!
        assertEquals(8_800.0, spec.snap(8_760.0), 0.0)
        assertEquals(20_000.0, spec.snap(25_000.0), 0.0)
        assertEquals(0.0, spec.snap(-3.0), 0.0)
        assertEquals(2.5, SliderUi(0.0, 5.0, 0.5).snap(2.6), 1e-9)
        d.sliderValue = spec.snap(8_760.0)
        assertEquals(Response.number(8_800.0), d.toResponse(q))
    }

    // ---- follow-up 11 language packs (not in the catalog until they are reviewed) ----

    private fun read(path: String): String? =
        javaClass.classLoader!!
            .getResourceAsStream(path)
            ?.use { it.readBytes().decodeToString() }

    @Test
    fun `language packs - every item renders, traces have stroke data, gestures and gaps reach the renderer`() {
        val strokes = StrokeIndex.parse(requireNotNull(read("strokes/index.json")))
        val tracks = listOf("ing-k", "ing-a", "kor-k", "kor-a", "jpn-k", "jpn-a", "zho-k", "zho-a")
        val packs = tracks.mapNotNull { t -> read("packs/bahasa/$t/v1.json")?.let { t to PackLoader.parse(it) } }
        assumeTrue("no follow-up 11 language packs bundled yet", packs.isNotEmpty())
        packs.forEach { (track, pack) ->
            val content = SessionContent.playable(Gating.gate(pack, developerDemo = true))
            content.items.forEach { item ->
                val q = StepMapper.question(item, Step.Role.PRACTICE, content, Lang.ID, pack.meta.targetLang)
                val at = "$track ${item.itemId}"
                assertTrue("$at (${item.type}) has no renderer", q.kind != RenderKind.UNSUPPORTED)
                val gestureKind = q.kind in setOf(RenderKind.PAIRS, RenderKind.BUCKETS, RenderKind.SEQUENCE)
                assertEquals(at, if (gestureKind) item.effectiveGesture else null, q.gesture)
                if (item.type == ItemType.TRACE) {
                    assertEquals(at, RenderKind.TRACE, q.kind)
                    val glyph = requireNotNull(strokes.keys[q.trace]) { "$at: no stroke data for ${q.trace}" }
                    // Tracing each guide stroke exactly must count, or the letter could never be finished.
                    glyph.polylines().forEach { s -> assertTrue("$at ${q.trace}", TraceMatcher.matches(s, s)) }
                }
                if (item.type == ItemType.AUDIO_MATCH) assertTrue(at, q.listen && q.audio != null && !q.audioMissing)
                if (q.blankInTarget && q.gesture == Gestures.DRAG) {
                    assertNotNull("$at: gap count differs from places", SlotBoard.inlineParts(q))
                }
            }
        }
    }

    @Test
    fun `hotspot answers are choices`() {
        val q =
            StepUi.Question(itemId = "H", kind = RenderKind.HOTSPOT, role = Step.Role.PRACTICE, prompt = "", target = null, help = emptyList())
        val d = AnswerDraft()
        assertNull(d.toResponse(q))
        d.choice = "roof"
        assertEquals(Response.choice("roof"), d.toResponse(q))
    }
}
