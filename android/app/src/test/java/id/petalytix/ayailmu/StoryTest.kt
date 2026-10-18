package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.content.ContentPack
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.Motion
import id.petalytix.ayailmu.core.content.MotionMath
import id.petalytix.ayailmu.core.content.MotionType
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.content.PackValidator
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.engine.Env
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.collection.FigureGallery
import id.petalytix.ayailmu.feature.collection.FigureUi
import id.petalytix.ayailmu.feature.collection.FiguresDataSource
import id.petalytix.ayailmu.feature.collection.FiguresUiState
import id.petalytix.ayailmu.feature.collection.FiguresViewModel
import id.petalytix.ayailmu.feature.collection.TrackStories
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.story.FigureName
import id.petalytix.ayailmu.feature.session.story.NarrationCue
import id.petalytix.ayailmu.feature.session.story.StoryLayerUi
import id.petalytix.ayailmu.feature.session.story.StoryLayout
import id.petalytix.ayailmu.feature.session.story.StoryMotion
import id.petalytix.ayailmu.feature.session.story.StoryNarration
import id.petalytix.ayailmu.feature.session.story.StoryPanelUi
import id.petalytix.ayailmu.feature.session.story.StorySeen
import id.petalytix.ayailmu.feature.session.story.StoryTimeline
import id.petalytix.ayailmu.feature.session.story.StoryUiMapper
import id.petalytix.ayailmu.feature.speedround.SpeedRound
import id.petalytix.ayailmu.feature.units.UnitPicks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs
import kotlin.random.Random

/**
 * Follow-up 12 story player (MODULES_LEVELS_STORIES.md section 2): the story UI model, the panel state machine,
 * narration cues, stage geometry, the motion adapter over MotionMath, a story item through a real session, the
 * places stories are left out of, and the figure gallery's rules.
 */
class StoryTest {
    // ---- the story UI model --------------------------------------------------------------------------------

    @Test
    fun `the fixture pack passes the pack validator`() {
        assertEquals(emptyList<Any>(), PackValidator.validate(pack))
    }

    @Test
    fun `a story maps to captions and narration of the profile language with layers in drawing order`() {
        val story = requireNotNull(content.story("ST-KARTINI"))
        val id = StoryUiMapper.map("ST-KARTINI", story, Lang.ID)
        val en = StoryUiMapper.map("ST-KARTINI", story, Lang.EN)
        assertEquals("Kartini dan surat-suratnya", id.title)
        assertEquals("Kartini and her letters", en.title)
        assertEquals(3, id.panels.size)
        assertEquals("Kartini suka membaca sampai larut malam.", id.panels[0].caption)
        assertEquals("Kartini loved reading late into the night.", en.panels[0].caption)
        assertEquals("id/sej_kartini_01", id.panels[0].narration)
        assertEquals("en/sej_kartini_01", en.panels[0].narration)
        // The lamp has z = -1, so it is drawn first, behind the others.
        assertEquals(listOf("hist_oil_lamp", "hist_sil_woman_kebaya", "hist_kartini_letters"), id.panels[0].layers.map { it.art })
        assertTrue(id.panels[0].layers.last().flip)
        // The panel zoom is written without a type and becomes a zoom motion.
        assertEquals(MotionType.ZOOM, id.panels[0].zoom?.type)
        assertEquals("hist_kartini_letters", id.emblem)
        assertEquals("Raden Ajeng Kartini", id.name)
        assertEquals("1879–1904", id.years)
    }

    @Test
    fun `a panel without a clip in the profile language has no narration and keeps its caption`() {
        val en = StoryUiMapper.map("ST-KARTINI", requireNotNull(content.story("ST-KARTINI")), Lang.EN)
        assertNull(en.panels[1].narration)
        assertEquals("She wrote letters about schools for girls.", en.panels[1].caption)
        assertNull(en.panels[2].narration)
    }

    @Test
    fun `figure names split off the years in brackets`() {
        assertEquals("Al-Khwarizmi", FigureName.name("Al-Khwarizmi (c. 780–c. 850)"))
        assertEquals("c. 780–c. 850", FigureName.years("Al-Khwarizmi (c. 780–c. 850)"))
        assertEquals("Wright brothers", FigureName.name("Wright brothers"))
        assertNull(FigureName.years("Wright brothers"))
        assertEquals("(1880–1968)", FigureName.name("(1880–1968)"))
    }

    @Test
    fun `every story item in the bundled catalog plays a story with captions in both languages`() {
        TestPacks.catalog.forEach { t ->
            t.content.items.filter { it.type == ItemType.STORY }.forEach { item ->
                listOf(Lang.ID, Lang.EN).filter { it in t.pack.meta.instructionLangs }.forEach { lang ->
                    val q = StepMapper.question(item, Step.Role.PRACTICE, t.content, lang, t.pack.meta.targetLang)
                    val story = requireNotNull(q.story) { "${item.itemId} has no visible story ${item.storyId}" }
                    assertTrue(item.itemId, story.panels.isNotEmpty())
                    assertTrue(item.itemId, story.panels.all { it.caption.isNotBlank() })
                    assertTrue(item.itemId, story.panels.all { p -> p.narration == null || p.narration.startsWith(lang.tag + "/") })
                }
            }
        }
    }

    // ---- StepMapper and AnswerDraft ------------------------------------------------------------------------

    @Test
    fun `a story item maps to the story renderer with its story`() {
        val q = mapped("SEJ-K-P-01-001")
        assertEquals(RenderKind.STORY, q.kind)
        assertEquals(RenderKind.STORY, StepMapper.kindOf(content.item("SEJ-K-P-01-001")))
        assertEquals("ST-KARTINI", q.story?.storyId)
        assertEquals("Tonton ceritanya.", q.prompt)
        assertTrue(q.options.isEmpty())
        assertNull(q.cardText)
    }

    @Test
    fun `a question about a story carries the story for watch again and keeps its own renderer`() {
        val q = mapped("SEJ-K-P-01-002")
        assertEquals(RenderKind.CHOICE, q.kind)
        assertEquals("ST-KARTINI", q.story?.storyId)
        assertNull(mapped("SEJ-K-P-01-003").story)
    }

    @Test
    fun `a story id that is not visible maps to no story and never blocks`() {
        val hidden = content.copy(stories = emptyMap())
        val q = StepMapper.question(content.item("SEJ-K-P-01-001"), Step.Role.PRACTICE, hidden, Lang.ID, null)
        assertEquals(RenderKind.STORY, q.kind)
        assertNull(q.story)
        // Nothing to watch: "Lanjut" answers it at once.
        assertEquals(Response.choice(AnswerDraft.SEEN), AnswerDraft().toResponse(q))
    }

    @Test
    fun `story items are playable in sessions`() {
        val playable = SessionContent.playable(content)
        assertTrue(playable.items.any { it.type == ItemType.STORY })
        assertNotNull(playable.story("ST-KARTINI"))
    }

    @Test
    fun `the story is answered as seen only once its last panel was reached`() {
        val q = mapped("SEJ-K-P-01-001")
        val draft = AnswerDraft()
        assertNull(draft.toResponse(q))
        draft.story = draft.storyTimeline(q).next()
        assertNull(draft.toResponse(q))
        draft.story = draft.storyTimeline(q).next()
        assertEquals(Response.choice(AnswerDraft.SEEN), draft.toResponse(q))
        // Going back to look again keeps it seen.
        draft.story = draft.storyTimeline(q).back().back()
        assertEquals(0, draft.storyTimeline(q).index)
        assertEquals(Response.choice(AnswerDraft.SEEN), draft.toResponse(q))
    }

    @Test
    fun `skipping the story answers it as seen`() {
        val q = mapped("SEJ-K-P-01-001")
        val draft = AnswerDraft()
        draft.story = draft.storyTimeline(q).skip()
        assertEquals(Response.choice(AnswerDraft.SEEN), draft.toResponse(q))
    }

    // ---- the panel state machine and narration --------------------------------------------------------------

    @Test
    fun `panels move only one at a time and stay in range`() {
        var t = StoryTimeline.start(3)
        assertTrue(t.isFirst)
        assertFalse(t.finished)
        assertEquals(t, t.back())
        t = t.next()
        assertEquals(1, t.index)
        t = t.next()
        assertTrue(t.isLast)
        assertTrue(t.finished)
        assertEquals(t, t.next())
        t = t.back()
        assertEquals(1, t.index)
        assertEquals(2, t.furthest)
        assertTrue(t.seen(2))
        assertFalse(StoryTimeline.start(3).seen(1))
        assertFalse(t.seen(3))
    }

    @Test
    fun `a story without panels is finished from the start`() {
        val t = StoryTimeline.start(0)
        assertTrue(t.isFirst)
        assertTrue(t.isLast)
        assertTrue(t.finished)
        assertEquals(t, t.next())
    }

    @Test
    fun `a page turn sounds only when the panel changes`() {
        val t = StoryTimeline.start(3)
        assertTrue(StoryTimeline.turnsPage(t, t.next()))
        assertFalse(StoryTimeline.turnsPage(t, t.back()))
        assertFalse(StoryTimeline.turnsPage(t, t.skip()))
    }

    @Test
    fun `skip is offered to adults and to anyone meeting the story again`() {
        assertTrue(StoryTimeline.offersSkip(adult = true, seenBefore = false))
        assertTrue(StoryTimeline.offersSkip(adult = false, seenBefore = true))
        assertFalse(StoryTimeline.offersSkip(adult = false, seenBefore = false))
    }

    @Test
    fun `narration plays when the clip is bundled and stops otherwise`() {
        val bundled = setOf("id/sej_kartini_01")
        assertEquals(NarrationCue.Play("id/sej_kartini_01"), StoryNarration.cue("id/sej_kartini_01") { it in bundled })
        assertEquals(NarrationCue.Stop, StoryNarration.cue("id/sej_kartini_02") { it in bundled })
        assertEquals(NarrationCue.Stop, StoryNarration.cue(null) { true })
        assertEquals("id/sej_kartini_01", StoryNarration.replay("id/sej_kartini_01") { it in bundled })
        assertNull(StoryNarration.replay("id/sej_kartini_02") { it in bundled })
    }

    @Test
    fun `seen stories come from answer events on story items`() {
        val history = listOf(event("SEJ-K-P-01-001"), event("SEJ-K-P-01-002"))
        assertEquals(setOf("ST-KARTINI"), StorySeen.storyIds(content.items, history))
        // Answering a question about a story does not count as seeing it.
        assertEquals(emptySet<String>(), StorySeen.storyIds(content.items, listOf(event("SEJ-K-P-01-002"))))
        assertTrue(StorySeen.before("SEJ-K-P-01-001", history))
        assertFalse(StorySeen.before("SEJ-K-P-02-001", history))
    }

    // ---- stage geometry ------------------------------------------------------------------------------------

    @Test
    fun `layer fractions become boxes on the stage with the drawing aspect`() {
        val stageW = 320f
        val stageH = StoryLayout.stageHeight(stageW)
        assertEquals(180f, stageH, 0.001f)
        val lamp = StoryLayerUi("hist_oil_lamp", 0.62, 0.22, 0.16)
        val r = StoryLayout.rect(lamp, stageW, stageH) { if (it == "hist_oil_lamp") 0.5f else 1f }
        assertEquals(198.4f, r.left, 0.001f)
        assertEquals(39.6f, r.top, 0.001f)
        assertEquals(51.2f, r.width, 0.001f)
        // Aspect 0.5 (twice as tall as wide).
        assertEquals(102.4f, r.height, 0.001f)
        val unknown = StoryLayout.rect(StoryLayerUi("missing", 0.1, 0.1, 0.25), stageW, stageH) { 0f }
        assertEquals(unknown.width, unknown.height, 0.001f)
    }

    @Test
    fun `a reveal wipes in from its side and a mirrored layer clips from the other side of its drawing`() {
        assertEquals(0f to 25f, StoryLayout.revealSpan(0.25, fromRight = false, flip = false, width = 100f))
        assertEquals(75f to 100f, StoryLayout.revealSpan(0.25, fromRight = true, flip = false, width = 100f))
        assertEquals(75f to 100f, StoryLayout.revealSpan(0.25, fromRight = false, flip = true, width = 100f))
        assertEquals(0f to 100f, StoryLayout.revealSpan(2.0, fromRight = false, flip = false, width = 100f))
        assertEquals(0f to 0f, StoryLayout.revealSpan(-1.0, fromRight = false, flip = false, width = 100f))
    }

    // ---- motion ------------------------------------------------------------------------------------------

    private fun layer(motion: Motion?) = StoryLayerUi("hist_quill", 0.4, 0.4, 0.2, motion = motion)

    private fun panel(vararg motions: Motion?, zoom: Motion? = null) =
        StoryPanelUi("hist_bg_sea", "c", null, layers = motions.map { layer(it) }, zoom = zoom)

    @Test
    fun `the entrance clock runs as long as the longest one-way motion`() {
        assertEquals(0L, StoryMotion.finiteMs(panel(null, Motion(MotionType.NONE))))
        assertEquals(900L, StoryMotion.finiteMs(panel(Motion(MotionType.FADE_IN, ms = 600, delayMs = 300), Motion(MotionType.SLIDE_IN))))
        // Loops do not count; the scene zoom does.
        assertEquals(0L, StoryMotion.finiteMs(panel(Motion(MotionType.GLOW, ms = 2400, loop = true))))
        assertEquals(5000L, StoryMotion.finiteMs(panel(Motion(MotionType.FADE_IN), zoom = Motion(MotionType.ZOOM, ms = 5000))))
        // A pulse without loop plays one cycle.
        assertEquals(2000L, StoryMotion.finiteMs(panel(Motion(MotionType.BOB, ms = 2000))))
    }

    @Test
    fun `loops repeat after one cycle for pulses and after there and back for moves`() {
        assertEquals(2400L, StoryMotion.loopPeriodMs(Motion(MotionType.GLOW, ms = 2400, loop = true)))
        assertEquals(6000L, StoryMotion.loopPeriodMs(Motion(MotionType.DRIFT, ms = 3000, loop = true)))
        assertEquals(8000L, StoryMotion.loopPeriodMs(Motion(MotionType.PATH, ms = 4000, loop = true, points = PATH)))
        assertNull(StoryMotion.loopPeriodMs(Motion(MotionType.DRIFT, ms = 3000)))
        // Entrances never loop, even if the pack says so.
        assertNull(StoryMotion.loopPeriodMs(Motion(MotionType.FADE_IN, loop = true)))
        assertNull(StoryMotion.loopPeriodMs(null))
        assertTrue(StoryMotion.loops(layer(Motion(MotionType.SWAY, loop = true))))
        assertFalse(StoryMotion.loops(layer(Motion(MotionType.SWAY))))
    }

    @Test
    fun `a loop ends where it began so it never jumps`() {
        listOf(
            Motion(MotionType.DRIFT, ms = 3000, loop = true, dx = 0.05),
            Motion(MotionType.PATH, ms = 4000, loop = true, points = PATH),
            Motion(MotionType.GLOW, ms = 2400, loop = true),
            Motion(MotionType.SWAY, ms = 2400, loop = true, deg = 4.0),
            Motion(MotionType.BOB, ms = 2000, loop = true, amp = 0.015),
        ).forEach { m ->
            val l = StoryLayerUi("hist_small_boat", 0.1, 0.5, 0.2, motion = m)
            val period = requireNotNull(StoryMotion.loopPeriodMs(m))
            val start = StoryMotion.atLoop(l, 0L)
            val end = StoryMotion.atLoop(l, period - 1)
            // Drawn on twos, a pulse may differ by one held drawing at the wrap, never more.
            val oneDrawing = 2 * Math.PI * MotionMath.TWOS_MS / m.effectiveMs()
            assertTrue("${m.type} dx", abs(start.dx - end.dx) < 0.002)
            assertTrue("${m.type} dy", abs(start.dy - end.dy) <= m.effectiveAmp() * oneDrawing + 1e-9)
            assertTrue("${m.type} alpha", abs(start.alpha - end.alpha) < 0.01)
            assertTrue("${m.type} rotation", abs(start.rotationDeg - end.rotationDeg) <= m.effectiveDeg() * oneDrawing + 1e-9)
        }
    }

    @Test
    fun `a loop with a delay rests until its delay is over`() {
        val m = Motion(MotionType.DRIFT, ms = 3000, loop = true, dx = 0.05, delayMs = 500)
        val l = layer(m)
        assertEquals(500, StoryMotion.loopDelayMs(m))
        assertEquals(0.0, StoryMotion.atLoop(l, 0L).dx, 1e-9)
        assertTrue(StoryMotion.atLoop(l, 1500L).dx > 0.0)
    }

    @Test
    fun `sway is held on twos like bob`() {
        val l = layer(Motion(MotionType.SWAY, ms = 2400, loop = true, deg = 5.0))
        val base = StoryMotion.at(l, 1000L)
        // 1000 ms falls in the drawing that starts at 996 ms (12 drawings a second): held until 1078 ms.
        assertEquals(base, StoryMotion.at(l, 1050L))
        assertEquals(base, StoryMotion.at(l, 1078L))
        assertTrue(base != StoryMotion.at(l, 1079L))
        assertEquals(0.5, base.originX, 1e-9)
        assertEquals(1.0, base.originY, 1e-9)
    }

    @Test
    fun `entrances end exactly where reduce-motion shows them`() {
        listOf(
            Motion(MotionType.FADE_IN, ms = 600, delayMs = 300),
            Motion(MotionType.SLIDE_IN, ms = 600, from = "left"),
            Motion(MotionType.REVEAL, ms = 1200, from = "right"),
            Motion(MotionType.ZOOM, ms = 4000, scaleTo = 1.1),
            Motion(MotionType.PATH, ms = 4000, points = PATH),
        ).forEach { m ->
            val l = layer(m)
            val end = requireNotNull(MotionMath.endMs(m))
            assertEquals("${m.type}", StoryMotion.still(l), StoryMotion.at(l, end))
            assertEquals("${m.type}", StoryMotion.still(l), StoryMotion.at(l, end + 10_000))
        }
        val still = StoryMotion.still(layer(Motion(MotionType.FADE_IN)))
        assertEquals(1.0, still.alpha, 1e-9)
        assertEquals(1.0, StoryMotion.still(layer(Motion(MotionType.REVEAL))).revealFraction, 1e-9)
        // Loops rest at full strength: a lamp that glows is lit, not dimmed.
        assertEquals(1.0, StoryMotion.still(layer(Motion(MotionType.GLOW, loop = true))).alpha, 1e-9)
        assertEquals(0.0, StoryMotion.still(layer(Motion(MotionType.SWAY, loop = true))).rotationDeg, 1e-9)
    }

    @Test
    fun `reduce-motion turns the scene zoom off`() {
        val p = panel(zoom = Motion(MotionType.ZOOM, ms = 5000, scaleFrom = 1.0, scaleTo = 1.06))
        assertEquals(1f, StoryMotion.sceneScale(p, 5000L, reduceMotion = true), 1e-6f)
        assertEquals(1f, StoryMotion.sceneScale(p, 0L, reduceMotion = false), 1e-6f)
        assertEquals(1.06f, StoryMotion.sceneScale(p, 5000L, reduceMotion = false), 1e-4f)
        assertEquals(1f, StoryMotion.sceneScale(panel(), 5000L, reduceMotion = false), 1e-6f)
    }

    @Test
    fun `motion stays quiet - nothing flashes, overshoots or leaves the frame`() {
        val motions =
            listOf(
                Motion(MotionType.FADE_IN, ms = 900),
                Motion(MotionType.SLIDE_IN, ms = 900, from = "top"),
                Motion(MotionType.DRIFT, ms = 2000, loop = true, dx = 0.08),
                Motion(MotionType.BOB, ms = 1600, loop = true, amp = 0.02),
                Motion(MotionType.SWAY, ms = 1600, loop = true, deg = 6.0),
                Motion(MotionType.GLOW, ms = 1600, loop = true),
                Motion(MotionType.ZOOM, ms = 6000, scaleFrom = 1.0, scaleTo = 1.12),
            )
        motions.forEach { m ->
            val l = layer(m)
            var lastSlide = Double.MAX_VALUE
            for (t in 0L..8000L step 17L) {
                val period = StoryMotion.loopPeriodMs(m)
                val tr = if (period != null) StoryMotion.atLoop(l, t % period) else StoryMotion.at(l, t)
                assertTrue("${m.type} alpha at $t", tr.alpha in 0.0..1.0)
                if (m.type == MotionType.GLOW) assertTrue("glow never dims below 0.65", tr.alpha >= MotionMath.GLOW_MIN_ALPHA - 1e-9)
                assertTrue("${m.type} dx at $t", abs(tr.dx) <= 0.15 + 1e-9)
                assertTrue("${m.type} dy at $t", abs(tr.dy) <= 0.15 + 1e-9)
                assertTrue("${m.type} rotation at $t", abs(tr.rotationDeg) <= 6.0 + 1e-9)
                assertTrue("${m.type} scale at $t", tr.scale in 1.0..1.12 + 1e-9)
                if (m.type == MotionType.SLIDE_IN) {
                    // Settles without bouncing: the distance left only ever shrinks.
                    assertTrue("slide_in settles at $t", abs(tr.dy) <= lastSlide + 1e-12)
                    lastSlide = abs(tr.dy)
                }
            }
        }
    }

    // ---- a story item through a real session --------------------------------------------------------------

    @Test
    fun `a story item is watched to the end then recorded as seen and its questions offer it again`() {
        val playable = SessionContent.playable(content)
        val rules = TestPacks.math.rules
        val ids = CountingIdGenerator()
        val now = Instant.parse("2026-10-18T02:00:00Z")
        var s =
            Session.start(
                StartArgs(
                    content = playable,
                    rules = rules,
                    history = emptyList(),
                    learnerId = "lrn-kid",
                    lang = Lang.ID,
                    audience = Audience.KIDS,
                    nowEpochMs = now.toEpochMilli(),
                    zone = ZoneId.of("Asia/Jakarta"),
                    budgetMinutes = 10,
                    screensSeen = emptyList(),
                    appVersion = "test",
                    random = Random(1),
                    ids = ids,
                ),
            )
        val events = mutableListOf<AnswerEvent>()
        val watched = mutableListOf<String>()
        var offeredAgain = false
        while (s.phase != SessionState.Phase.DONE) {
            val step = requireNotNull(s.currentStep)
            if (step.kind != Step.Kind.ITEM || s.phase != SessionState.Phase.STEP) {
                s = Session.advance(s, now.toEpochMilli())
                continue
            }
            val q = StepMapper.map(s, playable, Lang.ID, null) as StepUi.Question
            val response =
                if (q.kind == RenderKind.STORY) {
                    val draft = AnswerDraft()
                    // Check stays off until the last panel; no timer moves it on.
                    assertNull(draft.toResponse(q))
                    repeat(requireNotNull(q.story).panels.size - 1) { draft.story = draft.storyTimeline(q).next() }
                    watched += requireNotNull(q.story).storyId
                    requireNotNull(draft.toResponse(q))
                } else {
                    if (q.story?.storyId == "ST-KARTINI") offeredAgain = true
                    Response.dontKnow()
                }
            val r = Session.submit(s, response, Env(playable, rules, events.toList(), now.toEpochMilli(), 1_000L, ids = ids))
            val e = requireNotNull(r.event)
            if (q.kind == RenderKind.STORY) {
                assertEquals(Outcome.NOT_ASSESSED, e.outcome)
                assertEquals(ItemType.STORY, e.itemType)
            }
            events += e
            s = r.state
        }
        assertEquals("both stories were played", setOf("ST-KARTINI", "ST-SARTIKA"), watched.toSet())
        assertTrue("its question offered it again", offeredAgain)
        // The gallery now counts both figures as met.
        val figures = FigureGallery.figures(listOf(TrackStories(content, events)), Lang.ID)
        assertEquals(listOf(true, true), figures.map { it.met })
        // Until then neither was met.
        assertEquals(listOf(false, false), FigureGallery.figures(listOf(TrackStories(content, emptyList())), Lang.ID).map { it.met })
    }

    // ---- where stories never appear -------------------------------------------------------------------------

    @Test
    fun `story items never enter the speed round`() {
        assertFalse(SpeedRound.eligible(content.item("SEJ-K-P-01-001")))
        assertTrue(SpeedRound.eligible(content.item("SEJ-K-P-01-003")))
        val history = content.items.map { event(it.itemId) }
        assertTrue(SpeedRound.pick(content, history, Random(3)).none { it.type == ItemType.STORY })
    }

    @Test
    fun `the unit preview never shows a story and prefers a question that needs none`() {
        val preview = requireNotNull(UnitPicks.previewItem(content, "01", Audience.KIDS))
        assertEquals("SEJ-K-P-01-003", preview.itemId)
        // Unit 02 has only a question about its story: it is still previewable, the story itself never is.
        assertEquals("SEJ-K-P-02-002", UnitPicks.previewItem(content, "02", Audience.KIDS)?.itemId)
    }

    @Test
    fun `the unit challenge never picks a story`() {
        val history = content.items.map { event(it.itemId) }
        repeat(5) { seed ->
            val picks = UnitPicks.challengeItems(content, "01", Audience.KIDS, history, Random(seed))
            assertTrue(picks.isNotEmpty())
            assertTrue(picks.none { it.type == ItemType.STORY })
        }
    }

    // ---- the figure gallery --------------------------------------------------------------------------------

    @Test
    fun `the gallery lists every story once and marks the ones seen`() {
        val figures = FigureGallery.figures(listOf(TrackStories(content, listOf(event("SEJ-K-P-01-001")))), Lang.EN)
        assertEquals(listOf("ST-KARTINI", "ST-SARTIKA"), figures.map { it.storyId })
        assertEquals(listOf(true, false), figures.map { it.met })
        assertEquals("Raden Ajeng Kartini", figures[0].name)
        assertEquals("hist_kartini_letters", figures[0].art)
        // No emblem: the first scene stands in.
        assertEquals("hist_bg_classroom_old", figures[1].art)
        assertEquals("Kartini and her letters", figures[0].story.title)
        assertEquals(1, FigureGallery.metCount(figures))
    }

    @Test
    fun `a figure met on any track counts as met and stays listed once`() {
        val other = content.copy(track = "sej-k-m")
        val figures =
            FigureGallery.figures(
                listOf(TrackStories(content, emptyList()), TrackStories(other, listOf(event("SEJ-K-P-02-001")))),
                Lang.ID,
            )
        assertEquals(2, figures.size)
        assertFalse(figures.first { it.storyId == "ST-KARTINI" }.met)
        assertTrue(figures.first { it.storyId == "ST-SARTIKA" }.met)
    }

    @Test
    fun `a story hidden by gating is not in the gallery`() {
        val gated = Gating.gate(pack.copy(items = pack.items.filter { it.itemId != "SEJ-K-P-02-001" }), developerDemo = true)
        assertEquals(listOf("ST-KARTINI"), FigureGallery.figures(listOf(TrackStories(gated, emptyList())), Lang.ID).map { it.storyId })
        assertTrue(FigureGallery.figures(emptyList(), Lang.ID).isEmpty())
    }

    @Test
    fun `the gallery screen state comes from the data source`() {
        val figures = FigureGallery.figures(listOf(TrackStories(content, emptyList())), Lang.ID)
        val ready = FiguresViewModel(FiguresDataSource { figures }).state.value
        assertEquals(FiguresUiState.Ready(figures), ready)
        assertEquals(0, (ready as FiguresUiState.Ready).met)
        assertEquals(FiguresUiState.Failed, FiguresViewModel(FiguresDataSource { null }).state.value)
        assertEquals(FiguresUiState.Failed, FiguresViewModel(FiguresDataSource { error("disk") }).state.value)
    }

    @Test
    fun `figures in the gallery replay the same story the session plays`() {
        val fromSession = requireNotNull(mapped("SEJ-K-P-01-001").story)
        val fromGallery: FigureUi = FigureGallery.figures(listOf(TrackStories(content, emptyList())), Lang.ID).first()
        assertEquals(fromSession, fromGallery.story)
    }

    private fun mapped(id: String) = StepMapper.question(content.item(id), Step.Role.PRACTICE, content, Lang.ID, null)

    private fun event(itemId: String) = StoryPacks.event(itemId)

    private val pack: ContentPack get() = StoryPacks.pack
    private val content: GatedContent get() = StoryPacks.content

    private companion object {
        val PATH = listOf(listOf(0.1, 0.5), listOf(0.4, 0.45), listOf(0.7, 0.5))
    }
}

/**
 * A small Sejarah kids pack for app tests (follow-up 12): two figures in two units, one story each, questions about
 * them and one question without a story. Shared by StoryTest and SessionViewModelTest.
 */
internal object StoryPacks {
    val pack: ContentPack by lazy { PackLoader.parse(PACK) }
    val content: GatedContent by lazy { Gating.gate(pack, developerDemo = true) }

    const val PACK = """
{
  "meta": {
    "schema_version": 1,
    "content_version": "sej-k-test",
    "subject": "sejarah",
    "track": "sej-k",
    "mode": "casual",
    "audiences": ["kids"],
    "instruction_langs": ["id", "en"],
    "level": "pemula",
    "title": {"id": "Sejarah — Pemula (Anak)", "en": "History — Beginner (Kids)"}
  },
  "prompts": {
    "P-STORY": {"id": "Tonton ceritanya.", "en": "Watch the story."},
    "P-WHAT": {"id": "Apa yang Kartini tulis?", "en": "What did Kartini write?"},
    "P-KIND": {"id": "Mana yang menolong?", "en": "Which one is helping?"},
    "P-SCHOOL": {"id": "Apa yang Dewi Sartika dirikan?", "en": "What did Dewi Sartika found?"}
  },
  "units": [
    {"unit": "01", "title": {"id": "Pahlawan pendidikan", "en": "Heroes of education"}},
    {"unit": "02", "title": {"id": "Penolong", "en": "Helpers"}}
  ],
  "stories": {
    "ST-KARTINI": {
      "figure": "Raden Ajeng Kartini (1879–1904)",
      "title": {"id": "Kartini dan surat-suratnya", "en": "Kartini and her letters"},
      "source": "Kartini, Habis Gelap Terbitlah Terang (1911); Britannica: Kartini",
      "emblem": "hist_kartini_letters",
      "panels": [
        {
          "scene": "hist_bg_room_lamp",
          "caption": {"id": "Kartini suka membaca sampai larut malam.", "en": "Kartini loved reading late into the night."},
          "narration": {"id": "id/sej_kartini_01", "en": "en/sej_kartini_01"},
          "zoom": {"scale_from": 1.0, "scale_to": 1.06, "ms": 5000},
          "layers": [
            {"art": "hist_sil_woman_kebaya", "x": 0.08, "y": 0.3, "w": 0.3, "motion": {"type": "fade_in", "ms": 600}},
            {"art": "hist_oil_lamp", "x": 0.62, "y": 0.22, "w": 0.16, "z": -1, "motion": {"type": "glow", "ms": 2400, "loop": true}},
            {
              "art": "hist_kartini_letters",
              "x": 0.4,
              "y": 0.62,
              "w": 0.26,
              "flip": true,
              "motion": {"type": "slide_in", "from": "bottom", "ms": 600, "delay_ms": 300}
            }
          ]
        },
        {
          "scene": "hist_bg_classroom_old",
          "caption": {
            "id": "Ia menulis surat tentang sekolah untuk anak perempuan.",
            "en": "She wrote letters about schools for girls."
          },
          "narration": {"id": "id/sej_kartini_02"}
        },
        {
          "scene": "hist_bg_village_java",
          "caption": {
            "id": "Surat-suratnya dibukukan dan dibaca banyak orang.",
            "en": "Her letters became a book that many people read."
          }
        }
      ]
    },
    "ST-SARTIKA": {
      "figure": "Dewi Sartika (1884–1947)",
      "title": {"id": "Sekolah Dewi Sartika", "en": "Dewi Sartika's school"},
      "source": "Britannica: Dewi Sartika",
      "panels": [
        {
          "scene": "hist_bg_classroom_old",
          "caption": {"id": "Dewi Sartika mengajar anak perempuan.", "en": "Dewi Sartika taught girls."}
        },
        {
          "scene": "hist_bg_village_java",
          "caption": {"id": "Ia membuka sekolah di Bandung.", "en": "She opened a school in Bandung."}
        },
        {"scene": "hist_bg_classroom_old", "caption": {"id": "Sekolahnya terus tumbuh.", "en": "Her school kept growing."}}
      ]
    }
  },
  "items": [
    {
      "item_id": "SEJ-K-P-01-001",
      "unit": "01",
      "type": "story",
      "story_id": "ST-KARTINI",
      "skills": ["SEJ-KARTINI"],
      "pool": "PRACT",
      "order": 1,
      "prompt_id": "P-STORY",
      "content_version": "sej-k-test"
    },
    {
      "item_id": "SEJ-K-P-01-002",
      "unit": "01",
      "type": "pick_image",
      "story_id": "ST-KARTINI",
      "skills": ["SEJ-KARTINI"],
      "pool": "PRACT",
      "order": 2,
      "prompt_id": "P-WHAT",
      "content_version": "sej-k-test",
      "options": [
        {"id": "a", "image": "hist_kartini_letters", "text": {"id": "surat", "en": "letters"}, "correct": true},
        {"id": "b", "image": "hist_compass_old", "text": {"id": "kompas", "en": "a compass"}}
      ]
    },
    {
      "item_id": "SEJ-K-P-01-003",
      "unit": "01",
      "type": "pick_image",
      "skills": ["SEJ-VALUES"],
      "pool": "PRACT",
      "order": 3,
      "prompt_id": "P-KIND",
      "content_version": "sej-k-test",
      "options": [
        {"id": "a", "image": "val_help_friend", "text": {"id": "menolong teman", "en": "helping a friend"}, "correct": true},
        {"id": "b", "image": "val_litter", "text": {"id": "membuang sampah sembarangan", "en": "littering"}}
      ]
    },
    {
      "item_id": "SEJ-K-P-02-001",
      "unit": "02",
      "type": "story",
      "story_id": "ST-SARTIKA",
      "skills": ["SEJ-SARTIKA"],
      "pool": "PRACT",
      "order": 1,
      "prompt_id": "P-STORY",
      "content_version": "sej-k-test"
    },
    {
      "item_id": "SEJ-K-P-02-002",
      "unit": "02",
      "type": "pick_image",
      "story_id": "ST-SARTIKA",
      "skills": ["SEJ-SARTIKA"],
      "pool": "PRACT",
      "order": 2,
      "prompt_id": "P-SCHOOL",
      "content_version": "sej-k-test",
      "options": [
        {"id": "a", "image": "hist_dewi_sartika_school", "text": {"id": "sekolah", "en": "a school"}, "correct": true},
        {"id": "b", "image": "hist_coop_shop", "text": {"id": "toko koperasi", "en": "a co-op shop"}}
      ]
    }
  ]
}
"""

    /** The pack as a session gets it (demo gating, every unit open). */
    val playable: GatedContent by lazy { SessionContent.playable(content) }

    /** An answer event on [itemId] (stories: not assessed, like the engine records them). */
    fun event(itemId: String): AnswerEvent {
        val item = content.item(itemId)
        return AnswerEvent(
            answerId = "a-$itemId",
            learnerId = "lrn-kid",
            itemId = itemId,
            track = "sej-k",
            contentVersion = "sej-k-test",
            rulesVersion = "t",
            appVersion = "t",
            timestamp = "2026-10-17T02:00:00Z",
            localDate = "2026-10-17",
            sessionId = "ses-1",
            lang = Lang.ID,
            pool = item.pool,
            unit = item.unit,
            skills = item.skills,
            rawResponse = "seen",
            autoScore = emptyMap(),
            outcome = if (item.type == ItemType.STORY) Outcome.NOT_ASSESSED else Outcome.CORRECT,
            firstAttempt = true,
            freshEvidence = false,
            reviewStatus = item.reviewStatus,
            itemType = item.type,
        )
    }
}
