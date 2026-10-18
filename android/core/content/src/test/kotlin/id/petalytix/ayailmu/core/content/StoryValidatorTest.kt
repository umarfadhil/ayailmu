package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.ReviewStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Follow-up 12: the `story` type and the pack's stories (docs/content/MODULES_LEVELS_STORIES.md section 2). */
class StoryValidatorTest {
    private val sample: ContentPack by lazy { Fixtures.load("fixtures/story-sample-v1.json") }
    private val sid = "ST-KARTINI"
    private val story: Story by lazy { sample.stories.getValue(sid) }
    private val storyItem = "SEJ-T-M-01-001"
    private val pickItem = "SEJ-T-M-01-002"

    private fun item(id: String): Item = sample.items.first { it.itemId == id }

    private fun withItem(changed: Item): ContentPack =
        sample.copy(items = sample.items.map { if (it.itemId == changed.itemId) changed else it })

    private fun withStory(changed: Story): ContentPack = sample.copy(stories = sample.stories + (sid to changed))

    private fun withPanel(
        index: Int,
        change: (StoryPanel) -> StoryPanel,
    ): ContentPack = withStory(story.copy(panels = story.panels.mapIndexed { i, p -> if (i == index) change(p) else p }))

    private fun withLayer(
        panel: Int,
        layer: Int,
        change: (StoryLayer) -> StoryLayer,
    ): ContentPack = withPanel(panel) { p -> p.copy(layers = p.layers.mapIndexed { j, l -> if (j == layer) change(l) else l }) }

    private fun withMotion(motion: Motion): ContentPack = withLayer(0, 0) { it.copy(motion = motion) }

    private fun messages(
        pack: ContentPack,
        art: ArtIndex? = null,
    ): List<String> = PackValidator.validate(pack, art).map { it.toString() }

    /** Asserts exactly one problem and that its text contains [part]. */
    private fun assertOnly(
        part: String,
        pack: ContentPack,
        art: ArtIndex? = null,
    ) {
        val m = messages(pack, art)
        assertEquals(1, m.size, "expected one problem containing «$part», got $m")
        assertTrue(part in m.single(), "expected «$part» in ${m.single()}")
    }

    // ---- decoding -----------------------------------------------------------------------------------

    @Test
    fun `the sample decodes with its story, panels, layers and motions and is valid`() {
        assertEquals(emptyList(), PackValidator.validate(sample))
        val s = item(storyItem)
        assertEquals(ItemType.STORY, s.type)
        assertTrue(s.isStory)
        assertEquals(sid, s.storyId)
        assertEquals(sid, item(pickItem).storyId)
        assertFalse(item(pickItem).isStory)

        assertEquals("Raden Ajeng Kartini (1879–1904)", story.figure)
        assertEquals("hist_kartini_letters", story.emblem)
        assertEquals(3, story.panels.size)
        val p0 = story.panels[0]
        assertEquals("hist_bg_room_lamp", p0.scene)
        assertEquals("id/sej_kartini_01", p0.narrationFor(Lang.ID))
        assertEquals("en/sej_kartini_01", p0.narrationFor(Lang.EN))
        assertNull(story.panels[2].narrationFor(Lang.EN))
        val letters = p0.layers[2]
        assertEquals(0.40, letters.x)
        assertEquals(0.26, letters.w)
        val slide = assertNotNull(letters.motion)
        assertEquals(MotionType.SLIDE_IN, slide.type)
        assertEquals("bottom", slide.from)
        assertEquals(300, slide.delayMs)
        assertEquals(MotionType.GLOW, p0.layers[1].motion?.type)
        assertEquals(true, p0.layers[1].motion?.loop)

        val zoom = assertNotNull(story.panels[1].zoom)
        assertEquals(MotionType.NONE, zoom.type) // authors leave the type out
        assertEquals(1.06, zoom.scaleTo)
        assertEquals(MotionType.ZOOM, story.panels[1].sceneZoom?.type)
        assertEquals(listOf("hist_book_stack", "hist_kartini_letters", "hist_quill"), story.panels[1].layersInDrawOrder.map { it.art })

        val path = assertNotNull(story.panels[2].layers[0].motion)
        assertEquals(listOf(listOf(0.10, 0.55), listOf(0.30, 0.50), listOf(0.45, 0.55)), path.points)
        assertTrue(story.panels[2].layers[0].flip)
        assertEquals(-0.02, story.panels[2].layers[2].motion?.dy)
    }

    @Test
    fun `every motion type decodes from its snake_case name`() {
        val names =
            mapOf(
                "none" to MotionType.NONE, "fade_in" to MotionType.FADE_IN, "slide_in" to MotionType.SLIDE_IN,
                "drift" to MotionType.DRIFT, "bob" to MotionType.BOB, "sway" to MotionType.SWAY, "glow" to MotionType.GLOW,
                "path" to MotionType.PATH, "zoom" to MotionType.ZOOM, "reveal" to MotionType.REVEAL,
            )
        assertEquals(MotionType.entries.toSet(), names.values.toSet())
        names.forEach { (name, type) ->
            val m = ContentJson.json.decodeFromString(Motion.serializer(), """{"type": "$name", "scale_from": 1.02, "delay_ms": 5}""")
            assertEquals(type, m.type, name)
            assertEquals(1.02, m.scaleFrom)
            assertEquals(5, m.delayMs)
        }
    }

    @Test
    fun `story is a seen-only type with its own renderer`() {
        assertEquals(ItemType.Renderer.STORY, ItemType.STORY.renderer)
        assertFalse(ItemType.STORY.evidenceCapable)
        assertTrue(ItemType.STORY.isV1)
        val s = item(storyItem)
        assertFalse(s.isSequence || s.isPairs || s.isChoiceFamily || s.isNumeric || s.isTyped || s.isTrace)
        assertNull(s.effectiveGesture)
    }

    @Test
    fun `old packs decode with no stories and re-encode without the new keys`() {
        for (pack in listOf(Fixtures.math(), Fixtures.arabic(), Fixtures.load("fixtures/lang-sample-v1.json"))) {
            assertTrue(pack.stories.isEmpty())
            assertTrue(pack.items.all { it.storyId == null })
            val text = PackLoader.encode(pack)
            assertFalse("\"stories\"" in text || "\"story_id\"" in text)
        }
    }

    @Test
    fun `the sample round-trips through JSON`() {
        val again = PackLoader.parse(PackLoader.encode(sample))
        assertEquals(sample, again)
        assertTrue("\"delay_ms\":300" in PackLoader.encode(sample))
        assertTrue("\"scale_to\":1.06" in PackLoader.encode(sample))
    }

    // ---- story items --------------------------------------------------------------------------------

    @Test
    fun `a story item needs an existing story_id and takes no options or solution`() {
        val s = item(storyItem)
        val noId = messages(withItem(s.copy(storyId = null)))
        assertTrue(noId.any { "$storyItem: story item needs a story_id" == it }, "$noId")
        assertTrue(noId.any { "story $sid: not played by any story item" in it }, "$noId")
        assertTrue(messages(withItem(s.copy(storyId = "ST-NOPE"))).any { it == "$storyItem: unknown story_id ST-NOPE" })
        assertOnly("story items take no options", withItem(s.copy(options = listOf(ChoiceOption("a", text = LocalizedText("a", "a"))))))
        assertOnly("story items take no solution", withItem(s.copy(solution = listOf("a"))))
    }

    @Test
    fun `a question's story_id must exist and be played in the same unit`() {
        val q = item(pickItem)
        assertOnly("$pickItem: unknown story_id ST-NOPE", withItem(q.copy(storyId = "ST-NOPE")))
        val units = sample.units + UnitInfo("02", LocalizedText("Dua", "Two"))
        val moved = withItem(q.copy(unit = "02")).copy(units = units)
        assertOnly("story_id $sid is not played by a story item in unit 02", moved)
        assertEquals(emptyList(), PackValidator.validate(withItem(q.copy(storyId = null))))
    }

    @Test
    fun `every story is played by at least one story item`() {
        val spare = sample.copy(stories = sample.stories + ("ST-SPARE" to story))
        assertEquals(listOf("story ST-SPARE: not played by any story item (add a story item with story_id ST-SPARE)"), messages(spare))
    }

    // ---- story fields and panels --------------------------------------------------------------------

    @Test
    fun `figure, title and source must be filled`() {
        assertOnly("story $sid: figure must not be blank", withStory(story.copy(figure = " ")))
        assertOnly("story $sid: source must not be blank", withStory(story.copy(source = "")))
        assertOnly("story $sid.title: missing en", withStory(story.copy(title = LocalizedText("Kartini", ""))))
    }

    @Test
    fun `a story has 3 to 6 panels`() {
        assertOnly("needs 3–6 panels, has 2", withStory(story.copy(panels = story.panels.take(2))))
        val seven = List(7) { story.panels[it % 3] }
        assertOnly("needs 3–6 panels, has 7", withStory(story.copy(panels = seven)))
        assertEquals(emptyList(), PackValidator.validate(withStory(story.copy(panels = seven.take(6)))))
    }

    @Test
    fun `captions are bilingual, at most 2 sentences and at most 40 words`() {
        assertOnly("story $sid.panel[0].caption: missing id", withPanel(0) { it.copy(caption = LocalizedText("", "Reading.")) })
        val three = LocalizedText("Kartini membaca. Ia menulis. Ia mengajar.", "She read. She wrote.")
        assertOnly("story $sid.panel[1].caption.id: 3 sentences (at most 2)", withPanel(1) { it.copy(caption = three) })
        val long = (1..41).joinToString(" ") { "kata" } + "."
        val tooLong = withPanel(2) { it.copy(caption = LocalizedText("Pendek.", long)) }
        assertOnly("story $sid.panel[2].caption.en: 41 words (at most 40)", tooLong)
        val forty = (1..40).joinToString(" ") { "word" } + "."
        assertEquals(emptyList(), PackValidator.validate(withPanel(2) { it.copy(caption = LocalizedText("Pendek.", forty)) }))
    }

    @Test
    fun `sentences are counted kindly - initials, abbreviations, numbers and lower-case continuations`() {
        assertEquals(1, StoryText.sentenceCount("R.A. Kartini menulis surat."))
        assertEquals(1, StoryText.sentenceCount("B.J. Habibie lahir di Parepare."))
        assertEquals(1, StoryText.sentenceCount("Al-Khwarizmi (c. 780) menulis buku aljabar."))
        assertEquals(1, StoryText.sentenceCount("Harganya Rp 1.000 saja."))
        assertEquals(2, StoryText.sentenceCount("Ia membaca. \"Aku ingin sekolah!\""))
        assertEquals(2, StoryText.sentenceCount("Is it far? Yes, very far."))
        assertEquals(3, StoryText.sentenceCount("Satu. Dua. Tiga."))
        assertEquals(1, StoryText.sentenceCount("Tanpa titik"))
        assertEquals(0, StoryText.sentenceCount("  "))
        assertEquals(5, StoryText.wordCount("Kartini — suka membaca, sampai malam."))
    }

    @Test
    fun `narration keys are instruction languages and their clips are lang slash slug of that language`() {
        fun narrated(map: Map<String, String>) = withPanel(0) { it.copy(narration = map) }
        assertEquals(emptyList(), PackValidator.validate(narrated(emptyMap())))
        assertOnly("story $sid.panel[0].narration: ar is not an instruction language", narrated(mapOf("ar" to "ar/x")))
        assertOnly("narration.id: clip key id/Sej-01 must look like <lang>/<slug>", narrated(mapOf("id" to "id/Sej-01")))
        assertOnly("narration.en: clip id/sej_kartini_01 must be a en/ clip", narrated(mapOf("en" to "id/sej_kartini_01")))
    }

    // ---- layers -------------------------------------------------------------------------------------

    @Test
    fun `at most 4 layers and at most 3 moving ones`() {
        val still = StoryLayer("hist_book_stack", 0.1, 0.1, 0.1)
        val p0 = story.panels[0]
        assertEquals(emptyList(), PackValidator.validate(withPanel(0) { it.copy(layers = p0.layers + still) }))
        assertOnly("story $sid.panel[0]: at most 4 layers, has 5", withPanel(0) { it.copy(layers = p0.layers + still + still) })
        val moving = still.copy(motion = Motion(MotionType.FADE_IN))
        assertOnly("at most 3 moving layers, has 4", withPanel(0) { it.copy(layers = p0.layers + moving) })
        val none = still.copy(motion = Motion(MotionType.NONE))
        assertEquals(emptyList(), PackValidator.validate(withPanel(0) { it.copy(layers = p0.layers + none) }))
    }

    @Test
    fun `layer geometry stays on the scene`() {
        assertOnly("panel[0].layer[0]: x and y must be within 0..1", withLayer(0, 0) { it.copy(x = -0.1) })
        assertOnly("x and y must be within 0..1", withLayer(0, 0) { it.copy(y = 1.2) })
        assertOnly("w must be in (0, 1]", withLayer(0, 0) { it.copy(w = 0.0) })
        assertOnly("w must be in (0, 1]", withLayer(0, 0) { it.copy(x = 0.0, w = 1.03) })
        assertOnly("x + w must be ≤ 1.05", withLayer(0, 0) { it.copy(x = 0.8, w = 0.3) })
        assertEquals(emptyList(), PackValidator.validate(withLayer(0, 0) { it.copy(x = 0.8, w = 0.25) }))
    }

    @Test
    fun `art keys of scenes, layers and the emblem are checked only when an art index is supplied`() {
        val all =
            sample.stories.values.flatMap { s ->
                listOfNotNull(s.emblem) + s.panels.flatMap { p -> listOf(p.scene) + p.layers.map { it.art } }
            }
        val itemArt = sample.items.flatMap { i -> listOfNotNull(i.image) + i.options.mapNotNull { it.image } }
        val art = ArtIndex(keys = (all + itemArt).toSet())
        assertEquals(emptyList(), PackValidator.validate(sample, art))
        val missingScene = ArtIndex(keys = art.keys - "hist_bg_classroom_old")
        assertEquals(listOf("story $sid.panel[2].scene: unknown art key hist_bg_classroom_old"), messages(sample, missingScene))
        val missingLayer = ArtIndex(keys = art.keys - "hist_quill")
        assertEquals(listOf("story $sid.panel[1].layer[1]: unknown art key hist_quill"), messages(sample, missingLayer))
        val missingEmblem = withStory(story.copy(emblem = "hist_unknown"))
        assertEquals(listOf("story $sid.emblem: unknown art key hist_unknown"), messages(missingEmblem, art))
        assertEquals(emptyList(), PackValidator.validate(missingEmblem))
    }

    // ---- motion limits ------------------------------------------------------------------------------

    @Test
    fun `entrances are short - fade_in and slide_in at most 900 ms, reveal at most 2000 ms`() {
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.FADE_IN, ms = 900))))
        assertOnly("fade_in ms must be ≤ 900 (got 901)", withMotion(Motion(MotionType.FADE_IN, ms = 901)))
        assertOnly("slide_in ms must be ≤ 900 (got 1200)", withMotion(Motion(MotionType.SLIDE_IN, ms = 1200)))
        assertOnly("slide_in from must be left, right, top or bottom (got up)", withMotion(Motion(MotionType.SLIDE_IN, from = "up")))
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.REVEAL, ms = 2000, from = "right"))))
        assertOnly("reveal ms must be ≤ 2000 (got 2500)", withMotion(Motion(MotionType.REVEAL, ms = 2500)))
        assertOnly("reveal from must be left or right (got top)", withMotion(Motion(MotionType.REVEAL, from = "top")))
        assertOnly("ms must be > 0 (got 0)", withMotion(Motion(MotionType.FADE_IN, ms = 0)))
        assertOnly("delay_ms must be ≥ 0 (got -5)", withMotion(Motion(MotionType.FADE_IN, delayMs = -5)))
    }

    @Test
    fun `drift moves at most 8 percent and loops slowly`() {
        val widest = Motion(MotionType.DRIFT, dx = 0.08, dy = -0.08, ms = 2000, loop = true)
        assertEquals(emptyList(), PackValidator.validate(withMotion(widest)))
        assertOnly("drift dx must be within ±0.08 (got 0.1)", withMotion(Motion(MotionType.DRIFT, dx = 0.1)))
        assertOnly("drift dy must be within ±0.08 (got -0.09)", withMotion(Motion(MotionType.DRIFT, dy = -0.09)))
        assertOnly("drift ms must be ≥ 2000 when looping (got 1500)", withMotion(Motion(MotionType.DRIFT, ms = 1500, loop = true)))
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.DRIFT, ms = 1500))))
    }

    @Test
    fun `bob, sway and glow are slow and small`() {
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.BOB, amp = 0.02, ms = 1600, loop = true))))
        assertOnly("bob amp must be in (0, 0.02] (got 0.03)", withMotion(Motion(MotionType.BOB, amp = 0.03)))
        assertOnly("bob ms must be ≥ 1600 (got 1000)", withMotion(Motion(MotionType.BOB, ms = 1000)))
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.SWAY, deg = -6.0, ms = 1600))))
        assertOnly("sway deg must be within ±6.0 (got 8.0)", withMotion(Motion(MotionType.SWAY, deg = 8.0)))
        assertOnly("sway ms must be ≥ 1600 (got 800)", withMotion(Motion(MotionType.SWAY, ms = 800)))
        assertOnly("glow ms must be ≥ 1600 (got 500)", withMotion(Motion(MotionType.GLOW, ms = 500, loop = true)))
    }

    @Test
    fun `a path has 2 to 6 points on the scene and takes at most 6 s`() {
        val two = listOf(listOf(0.1, 0.5), listOf(0.6, 0.5))
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.PATH, points = two, ms = 6000))))
        assertOnly("path needs 2–6 points, has 1", withMotion(Motion(MotionType.PATH, points = two.take(1))))
        assertOnly("path needs 2–6 points, has 0", withMotion(Motion(MotionType.PATH)))
        assertOnly("path needs 2–6 points, has 7", withMotion(Motion(MotionType.PATH, points = List(7) { listOf(0.1, 0.1) })))
        val offScene = Motion(MotionType.PATH, points = listOf(listOf(0.1, 0.5), listOf(1.2, 0.5)))
        assertOnly("path point 1 must be [x, y] within 0..1", withMotion(offScene))
        assertOnly("path point 0 must be [x, y]", withMotion(Motion(MotionType.PATH, points = listOf(listOf(0.1), listOf(0.2, 0.5)))))
        assertOnly("path ms must be ≤ 6000 (got 7000)", withMotion(Motion(MotionType.PATH, points = two, ms = 7000)))
    }

    @Test
    fun `zoom stays within 1 and 1_12 and takes at most 6 s, on a layer or a panel`() {
        assertEquals(emptyList(), PackValidator.validate(withMotion(Motion(MotionType.ZOOM, scaleFrom = 1.0, scaleTo = 1.12, ms = 6000))))
        assertOnly(
            "zoom scale_from and scale_to must be within 1.0–1.12 (got 1.0, 1.2)",
            withMotion(Motion(MotionType.ZOOM, scaleTo = 1.2)),
        )
        assertOnly("within 1.0–1.12 (got 0.9, 1.06)", withMotion(Motion(MotionType.ZOOM, scaleFrom = 0.9)))
        assertOnly("zoom ms must be ≤ 6000 (got 8000)", withMotion(Motion(MotionType.ZOOM, ms = 8000)))
        assertOnly("panel[1].zoom: zoom ms must be ≤ 6000", withPanel(1) { it.copy(zoom = Motion(scaleTo = 1.1, ms = 9000)) })
        val fading = withPanel(1) { it.copy(zoom = Motion(MotionType.FADE_IN)) }
        assertOnly("panel[1].zoom: a panel zoom is a zoom (leave type out), not fade_in", fading)
        assertEquals(emptyList(), PackValidator.validate(withPanel(1) { it.copy(zoom = Motion(MotionType.ZOOM)) }))
    }

    // ---- gating -------------------------------------------------------------------------------------

    @Test
    fun `a story is visible exactly when its story item is`() {
        val demo = Gating.gate(sample, developerDemo = true)
        assertEquals(setOf(sid), demo.stories.keys)
        assertEquals(story, demo.story(sid))
        assertEquals(story, demo.story(demo.item(pickItem).storyId))
        assertNull(demo.story(null))

        // Prod shows only approved, non-synthetic content.
        val real = sample.copy(synthetic = false)
        assertTrue(Gating.gate(real, developerDemo = false).stories.isEmpty())
        val approvedQuestion = real.items.map { if (it.itemId == pickItem) it.copy(reviewStatus = ReviewStatus.APPROVED) else it }
        val onlyQuestion = Gating.gate(real.copy(items = approvedQuestion), developerDemo = false)
        assertEquals(listOf(pickItem), onlyQuestion.items.map { it.itemId })
        assertNull(onlyQuestion.story(sid))
        val approvedBoth =
            real.items.map { if (it.itemId == pickItem || it.itemId == storyItem) it.copy(reviewStatus = ReviewStatus.APPROVED) else it }
        assertEquals(story, Gating.gate(real.copy(items = approvedBoth), developerDemo = false).story(sid))
    }
}
