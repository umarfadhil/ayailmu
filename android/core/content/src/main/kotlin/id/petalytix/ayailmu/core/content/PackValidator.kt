package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Pool
import kotlin.math.abs

/**
 * The art catalog the packs may reference (`content/src/main/assets/art/index.json`, written by the art tool in
 * `art/tools/`). [regions] lists the named tap areas published for scene pictures.
 */
@kotlinx.serialization.Serializable
data class ArtIndex(
    val keys: Set<String> = emptySet(),
    val regions: Map<String, Map<String, Region>> = emptyMap(),
)

/** One validation failure; `validatePacks` prints these and fails the build (CR-I18N-5). */
data class PackProblem(
    val path: String,
    val message: String,
) {
    override fun toString(): String = "$path: $message"
}

/**
 * Pack validation (CR-ENG-1, CR-ENG-5, CR-I18N-5, framework §1b). Ported from the prototype's
 * `validatePack` and extended: bilingual completeness, catalog types, gems need sources, numeric/sequence/
 * pair solutions, readings. Harakat checks apply only when the pack's target language is Arabic.
 * Follow-up 11 (INTERACTIONS_AUDIO.md §2): gestures per type, clip keys, romanization and `trace` items.
 * Follow-up 12 (MODULES_LEVELS_STORIES.md §1–2): item level = pack level, `story` items and the pack's stories.
 */
object PackValidator {
    const val SUPPORTED_SCHEMA_VERSION = 1

    private val ARABIC_LETTER = Regex("[\\u0621-\\u064A\\u0671-\\u06D3]")
    private val HARAKAT = Regex("[\\u064B-\\u0652]")
    private val SPLIT = Regex("[\\s.,:؛،!?«»\"()]+")

    /** Voice clip key `<lang>/<slug>` (INTERACTIONS_AUDIO.md §3.1), e.g. `ko/sagwa`, `zh/ni_hao`. */
    private val CLIP_KEY = Regex("^[a-z]{2}/[a-z0-9_]+$")

    fun isClipKey(key: String): Boolean = CLIP_KEY.matches(key)

    /** Every Arabic word must carry vowel marks (Trial_App_Spec §5; CR-ENG-6). */
    fun missingHarakat(text: String): List<String> =
        text.split(SPLIT).filter { w -> ARABIC_LETTER.containsMatchIn(w) && !HARAKAT.containsMatchIn(w) }

    fun validateMeta(meta: PackMeta): List<PackProblem> {
        val problems = mutableListOf<PackProblem>()
        if (meta.schemaVersion != SUPPORTED_SCHEMA_VERSION) {
            problems += PackProblem("schema_version", "expected $SUPPORTED_SCHEMA_VERSION, got ${meta.schemaVersion}")
        }
        if (meta.contentVersion.isBlank()) problems += PackProblem("content_version", "must not be blank")
        if (meta.track.isBlank()) problems += PackProblem("track", "must not be blank")
        if (meta.audiences.isEmpty()) problems += PackProblem("audiences", "at least one audience")
        if (meta.instructionLangs.isEmpty()) problems += PackProblem("instruction_langs", "at least one language")
        problems += checkText("title", meta.title, meta.instructionLangs)
        return problems
    }

    /**
     * [art] and [strokes] are the published indexes (`art/index.json`, `strokes/index.json`); when one is null
     * the keys that point into it are not checked.
     */
    fun validate(
        pack: ContentPack,
        art: ArtIndex? = null,
        strokes: StrokeIndex? = null,
    ): List<PackProblem> {
        val p = mutableListOf<PackProblem>()
        p += validateMeta(pack.meta)

        fun checkArt(
            at: String,
            key: String?,
        ) {
            if (key != null && art != null && key !in art.keys) p += PackProblem(at, "unknown art key $key")
        }
        val unitIds = pack.units.map { it.unit }.toSet()
        if (unitIds.size != pack.units.size) p += PackProblem("units", "duplicate unit")
        pack.units.forEach { u ->
            p += checkText("unit ${u.unit}.title", u.title, pack.meta.instructionLangs)
            checkArt("unit ${u.unit}.sticker", u.sticker)
        }
        val langs = pack.meta.instructionLangs
        val arabic = pack.meta.targetLang == "ar"
        val version = pack.meta.contentVersion

        pack.prompts.forEach { (id, t) -> p += checkText("prompts.$id", t, langs) }
        pack.feedback.forEach { (id, t) -> p += checkText("feedback.$id", t, langs) }

        for (s in pack.screens) {
            val at = "screen ${s.screenId}"
            p += checkText("$at.title", s.title, langs)
            s.body.forEachIndexed { i, t -> p += checkText("$at.body[$i]", t, langs) }
            s.clueParagraph?.let { if (it !in s.body.indices) p += PackProblem(at, "clue_paragraph out of range") }
            for (ex in s.examples) {
                p += checkText("$at.example", ex.gloss, langs)
                if (arabic) ex.targetText?.let { bare(it) }?.let { p += PackProblem(at, "harakat missing in $it") }
            }
        }
        pack.readings.forEach { (id, r) ->
            r.body.forEachIndexed { i, t -> p += checkText("reading $id.body[$i]", t, langs) }
            if (arabic) r.targetText?.let { bare(it) }?.let { p += PackProblem("reading $id", "harakat missing in $it") }
        }

        // Units in which each story is played (questions about a story sit in the same unit as its story item).
        val storyUnits: Map<String, Set<String>> =
            pack.items
                .filter { it.isStory && it.storyId != null }
                .groupBy({ it.storyId.orEmpty() }, { it.unit })
                .mapValues { it.value.toSet() }
        val ids = HashSet<String>()
        for (item in pack.items) {
            val id = item.itemId
            if (!ids.add(id)) p += PackProblem(id, "duplicate item_id")
            if (!item.constructed && arabic) p += PackProblem(id, "constructed must be true in the Arabic track")
            if (!pack.prompts.containsKey(item.promptId)) p += PackProblem(id, "unknown prompt_id ${item.promptId}")
            if (item.contentVersion != version) p += PackProblem(id, "content_version mismatch")
            item.level?.let { lv ->
                if (lv != pack.meta.level) {
                    p += PackProblem(id, "level ${levelName(lv)} does not match the pack level ${levelName(pack.meta.level)}")
                }
            }
            item.storyId?.let { sid ->
                if (!pack.stories.containsKey(sid)) {
                    p += PackProblem(id, "unknown story_id $sid")
                } else if (!item.isStory && item.unit !in storyUnits[sid].orEmpty()) {
                    p += PackProblem(id, "story_id $sid is not played by a story item in unit ${item.unit}")
                }
            }
            if (item.gem && item.source.isNullOrBlank()) p += PackProblem(id, "gem items need a source")
            if (item.gem && item.pool != Pool.GEM && item.type != ItemType.INFO_CARD) {
                p += PackProblem(id, "gem flag belongs on GEM-pool or info_card items")
            }
            item.readingId?.let { if (!pack.readings.containsKey(it)) p += PackProblem(id, "unknown reading_id $it") }
            if (unitIds.isNotEmpty() && item.unit !in unitIds) p += PackProblem(id, "unit ${item.unit} is not listed in units")
            checkArt(id, item.image)
            item.options.forEach { o -> checkArt("$id.option.${o.id}", o.image) }
            checkClip(id, item.audio)?.let { p += it }
            item.options.forEach { o ->
                val at = "$id.option.${o.id}"
                checkClip(at, o.audio)?.let { p += it }
                if (o.romanization != null && o.romanization.isBlank()) p += PackProblem(at, "romanization must not be blank")
            }
            if (item.romanization != null && item.romanization.isBlank()) p += PackProblem(id, "romanization must not be blank")
            item.gesture?.let { g ->
                val allowed = Gestures.allowedFor(item.type)
                when {
                    g !in Gestures.ALL -> p += PackProblem(id, "unknown gesture $g")
                    g !in allowed -> {
                        val what = if (allowed.isEmpty()) "no gesture" else "only ${allowed.sorted().joinToString("|")}"
                        p += PackProblem(id, "gesture $g is not allowed here (${typeName(item.type)} takes $what)")
                    }
                }
            }
            if (item.trace != null && !item.isTrace) p += PackProblem(id, "trace key on a non-trace item (${typeName(item.type)})")
            item.modelAnswer?.let { p += checkText("$id.model_answer", it, langs) }
            item.wordMeaning?.let { p += checkText("$id.word_meaning", it, langs) }
            item.helpLines.forEach { h -> p += checkText("$id.help_line", h.meaning, langs) }
            item.feedbackIds.values.forEach { fid -> if (!pack.feedback.containsKey(fid)) p += PackProblem(id, "unknown feedback id $fid") }

            if (arabic) {
                val bareWords =
                    listOfNotNull(item.targetText) + item.helpLines.map { it.word } + item.options.mapNotNull { it.targetText }
                bareWords.mapNotNull { bare(it) }.forEach { p += PackProblem(id, "harakat missing in $it") }
            }

            when {
                item.isChoiceFamily -> {
                    if (item.options.count { it.correct } != 1) p += PackProblem(id, "choice item needs exactly one correct option")
                    if (item.type == ItemType.TRUE_FALSE && item.options.size != 2) p += PackProblem(id, "true_false needs exactly two options")
                    if (item.type == ItemType.PICK_IMAGE && item.options.any { it.image == null }) p += PackProblem(id, "pick_image options need images")
                    // Follow-up 11: "listen, then tap the picture" - picture options are fine.
                    val bareOption = item.options.any { it.text == null && it.targetText == null && it.image == null }
                    if (item.type == ItemType.AUDIO_MATCH && bareOption) {
                        p += PackProblem(id, "audio_match options need text, target_text or image")
                    }
                    item.options.forEach { o ->
                        o.text?.let { p += checkText("$id.option.${o.id}", it, langs) }
                        o.feedbackId?.let { fid -> if (!pack.feedback.containsKey(fid)) p += PackProblem(id, "unknown feedback id $fid") }
                    }
                    if (item.isReferentChoice && item.referent == null) p += PackProblem(id, "referent choice needs a referent")
                    if (item.type == ItemType.TAP_HOTSPOT) {
                        if (item.image == null) p += PackProblem(id, "tap_hotspot needs an image")
                        item.options.forEach { o ->
                            val r = o.region
                            if (r == null || !r.isValid) {
                                p += PackProblem(id, "tap_hotspot option ${o.id} needs a valid region")
                            } else {
                                val published = item.image?.let { art?.regions?.get(it) }
                                if (published != null && published.values.none { it.near(r) }) {
                                    p += PackProblem(id, "region of option ${o.id} is not a published region of ${item.image}")
                                }
                            }
                        }
                    }
                    if (item.type == ItemType.STORY_CHOICE && item.readingId == null) p += PackProblem(id, "story_choice needs a reading_id")
                    if (item.type == ItemType.DAILY_PUZZLE && item.pool != Pool.SPARE) p += PackProblem(id, "daily_puzzle items use pool SPARE")
                }
                item.isTyped -> {
                    for (lang in langs) {
                        val acc = item.accepted[lang.tag]
                        if (acc == null || acc.terms.isEmpty()) p += PackProblem(id, "typed item needs accepted terms for ${lang.tag}")
                        acc?.knownErrors?.forEach { k -> if (!pack.feedback.containsKey(k.feedbackId)) p += PackProblem(id, "unknown feedback id ${k.feedbackId}") }
                        acc?.pendingTerms?.forEach { t -> if (!pack.feedback.containsKey(t.feedbackId)) p += PackProblem(id, "unknown feedback id ${t.feedbackId}") }
                    }
                    if (item.isParaphrase && item.referent == null) p += PackProblem(id, "paraphrase item needs a referent")
                }
                item.isNumeric -> {
                    val numeric = item.numeric
                    if (numeric == null) p += PackProblem(id, "numeric item needs a numeric answer")
                    if (item.type == ItemType.ESTIMATE_SLIDER) {
                        if ((numeric?.tolerance ?: 0.0) <= 0.0) p += PackProblem(id, "estimate_slider needs a tolerance band")
                        val s = item.slider
                        if (s == null || s.min >= s.max || s.step <= 0.0) {
                            p += PackProblem(id, "estimate_slider needs slider {min < max, step > 0}")
                        } else if (numeric != null && (numeric.value < s.min || numeric.value > s.max)) {
                            p += PackProblem(id, "estimate_slider answer is outside the slider range")
                        }
                    }
                    if (item.type == ItemType.DAILY_PUZZLE && item.pool != Pool.SPARE) p += PackProblem(id, "daily_puzzle items use pool SPARE")
                }
                item.isSequence -> {
                    if (item.solution.isEmpty()) p += PackProblem(id, "sequence item needs a solution")
                    val optionIds = item.options.map { it.id }.toSet()
                    if (!optionIds.containsAll(item.solution)) p += PackProblem(id, "solution references unknown options")
                    item.options.forEach { o -> o.text?.let { p += checkText("$id.option.${o.id}", it, langs) } }
                }
                item.isPairs -> {
                    if (item.solutionPairs.isEmpty()) p += PackProblem(id, "pair item needs solution_pairs")
                    val optionIds = item.options.map { it.id }.toSet()
                    if (!optionIds.containsAll(item.solutionPairs.keys + item.solutionPairs.values)) {
                        p += PackProblem(id, "solution_pairs reference unknown options")
                    }
                    if (item.type == ItemType.MEMORY_FLIP && item.solutionPairs.values.toSet().size != item.solutionPairs.size) {
                        p += PackProblem(id, "memory_flip pairs must be one-to-one")
                    }
                    item.options.forEach { o -> o.text?.let { p += checkText("$id.option.${o.id}", it, langs) } }
                }
                item.type == ItemType.MINI_READING -> {
                    if (item.readingId == null) p += PackProblem(id, "mini_reading needs a reading_id")
                }
                item.isTrace -> {
                    val key = item.trace
                    if (key.isNullOrBlank()) {
                        p += PackProblem(id, "trace item needs a trace key")
                    } else if (strokes != null && key !in strokes.keys) {
                        p += PackProblem(id, "unknown trace key $key")
                    }
                    if (item.options.isNotEmpty()) p += PackProblem(id, "trace items take no options")
                    if (item.solution.isNotEmpty() || item.solutionPairs.isNotEmpty()) p += PackProblem(id, "trace items take no solution")
                }
                item.isStory -> {
                    if (item.storyId.isNullOrBlank()) p += PackProblem(id, "story item needs a story_id")
                    if (item.options.isNotEmpty()) p += PackProblem(id, "story items take no options")
                    if (item.solution.isNotEmpty() || item.solutionPairs.isNotEmpty()) p += PackProblem(id, "story items take no solution")
                }
                item.type == ItemType.INFO_CARD -> Unit
                else -> Unit // speed_round is a practice mode, never a pack item
            }

            if (item.pool == Pool.FOCUS && item.focusFor == null) p += PackProblem(id, "FOCUS item needs focus_for")
            if (item.pool == Pool.GEM && !item.gem) p += PackProblem(id, "GEM-pool item must set gem=true")
            if (item.type == ItemType.AUDIO_MATCH && item.audio.isNullOrBlank()) p += PackProblem(id, "audio_match needs an audio asset")
            if (item.type == ItemType.SPEED_ROUND) p += PackProblem(id, "speed_round is a practice mode, not a pack item")
        }
        pack.stories.forEach { (sid, story) ->
            p += validateStory(sid, story, langs, art)
            if (sid !in storyUnits) p += PackProblem("story $sid", "not played by any story item (add a story item with story_id $sid)")
        }
        return p
    }

    /** One story (MODULES_LEVELS_STORIES.md section 2, [StoryLimits]); art keys are checked when [art] is given. */
    fun validateStory(
        sid: String,
        story: Story,
        langs: List<Lang>,
        art: ArtIndex? = null,
    ): List<PackProblem> {
        val p = mutableListOf<PackProblem>()
        val at = "story $sid"

        fun checkArt(
            path: String,
            key: String?,
        ) {
            if (key != null && art != null && key !in art.keys) p += PackProblem(path, "unknown art key $key")
        }
        if (story.figure.isBlank()) p += PackProblem(at, "figure must not be blank")
        if (story.source.isBlank()) p += PackProblem(at, "source must not be blank (a real, checkable source)")
        p += checkText("$at.title", story.title, langs)
        if (story.emblem != null && story.emblem.isBlank()) p += PackProblem(at, "emblem must not be blank (leave it out)")
        checkArt("$at.emblem", story.emblem)
        val n = story.panels.size
        if (n < StoryLimits.MIN_PANELS || n > StoryLimits.MAX_PANELS) {
            p += PackProblem(at, "needs ${StoryLimits.MIN_PANELS}–${StoryLimits.MAX_PANELS} panels, has $n")
        }
        story.panels.forEachIndexed { i, panel ->
            val pa = "$at.panel[$i]"
            if (panel.scene.isBlank()) p += PackProblem(pa, "scene must not be blank")
            checkArt("$pa.scene", panel.scene.ifBlank { null })
            p += checkText("$pa.caption", panel.caption, langs)
            for (lang in langs) {
                val text = panel.caption.resolve(lang)
                val sentences = StoryText.sentenceCount(text)
                val words = StoryText.wordCount(text)
                if (sentences > StoryLimits.CAPTION_MAX_SENTENCES) {
                    p += PackProblem("$pa.caption.${lang.tag}", "$sentences sentences (at most ${StoryLimits.CAPTION_MAX_SENTENCES})")
                }
                if (words > StoryLimits.CAPTION_MAX_WORDS) {
                    p += PackProblem("$pa.caption.${lang.tag}", "$words words (at most ${StoryLimits.CAPTION_MAX_WORDS})")
                }
            }
            val tags = langs.map { it.tag }.toSet()
            panel.narration.forEach { (lang, clip) ->
                when {
                    lang !in tags -> {
                        p += PackProblem("$pa.narration", "$lang is not an instruction language of the pack (${tags.joinToString("|")})")
                    }
                    !isClipKey(clip) -> p += PackProblem("$pa.narration.$lang", "clip key $clip must look like <lang>/<slug>")
                    clip.substringBefore('/') != lang -> p += PackProblem("$pa.narration.$lang", "clip $clip must be a $lang/ clip")
                }
            }
            if (panel.layers.size > StoryLimits.MAX_LAYERS) {
                p += PackProblem(pa, "at most ${StoryLimits.MAX_LAYERS} layers, has ${panel.layers.size}")
            }
            val moving = panel.layers.count { it.motion?.isMoving == true }
            if (moving > StoryLimits.MAX_MOVING_LAYERS) {
                p += PackProblem(pa, "at most ${StoryLimits.MAX_MOVING_LAYERS} moving layers, has $moving")
            }
            panel.zoom?.let { z ->
                if (z.type != MotionType.NONE && z.type != MotionType.ZOOM) {
                    p += PackProblem("$pa.zoom", "a panel zoom is a zoom (leave type out), not ${motionName(z.type)}")
                } else {
                    motionProblems(z.copy(type = MotionType.ZOOM)).forEach { p += PackProblem("$pa.zoom", it) }
                }
            }
            panel.layers.forEachIndexed { j, layer ->
                val la = "$pa.layer[$j]"
                if (layer.art.isBlank()) p += PackProblem(la, "art must not be blank")
                checkArt(la, layer.art.ifBlank { null })
                if (layer.x !in 0.0..1.0 || layer.y !in 0.0..1.0) {
                    p += PackProblem(la, "x and y must be within 0..1 (got ${layer.x}, ${layer.y})")
                }
                if (layer.w <= 0.0 || layer.w > 1.0) p += PackProblem(la, "w must be in (0, 1] (got ${layer.w})")
                if (layer.x + layer.w > StoryLimits.MAX_RIGHT_EDGE + EPS) {
                    val edge = StoryLimits.MAX_RIGHT_EDGE
                    p += PackProblem(la, "x + w must be ≤ $edge (got ${layer.x + layer.w}): the layer runs off the scene")
                }
                layer.motion?.let { m -> motionProblems(m).forEach { p += PackProblem("$la.motion", it) } }
            }
        }
        return p
    }

    /** Motion limits of MODULES_LEVELS_STORIES.md section 2 (nothing flashes, spins, shakes or bounces). */
    fun motionProblems(m: Motion): List<String> {
        val out = mutableListOf<String>()
        val name = motionName(m.type)
        m.ms?.let { if (it <= 0) out += "ms must be > 0 (got $it)" }
        m.delayMs?.let { if (it < 0) out += "delay_ms must be ≥ 0 (got $it)" }
        val ms = m.effectiveMs()

        fun atMost(
            limit: Int,
        ) {
            if (ms > limit) out += "$name ms must be ≤ $limit (got $ms)"
        }

        fun atLeast(
            limit: Int,
            why: String = "",
        ) {
            if (ms < limit) out += "$name ms must be ≥ $limit$why (got $ms)"
        }
        when (m.type) {
            MotionType.NONE -> Unit
            MotionType.FADE_IN -> atMost(StoryLimits.ENTRANCE_MAX_MS)
            MotionType.SLIDE_IN -> {
                atMost(StoryLimits.ENTRANCE_MAX_MS)
                m.from?.let { if (it !in MotionSide.SLIDE) out += "slide_in from must be left, right, top or bottom (got $it)" }
            }
            MotionType.DRIFT -> {
                val dx = m.dx
                val dy = m.dy
                val max = StoryLimits.DRIFT_MAX
                if (dx != null && abs(dx) > max + EPS) out += "drift dx must be within ±$max (got $dx)"
                if (dy != null && abs(dy) > max + EPS) out += "drift dy must be within ±$max (got $dy)"
                if (m.loop) atLeast(StoryLimits.DRIFT_LOOP_MIN_MS, " when looping")
            }
            MotionType.BOB -> {
                val amp = m.amp
                if (amp != null && (amp <= 0.0 || amp > StoryLimits.BOB_MAX_AMP + EPS)) {
                    out += "bob amp must be in (0, ${StoryLimits.BOB_MAX_AMP}] (got $amp)"
                }
                atLeast(StoryLimits.PULSE_MIN_MS)
            }
            MotionType.SWAY -> {
                val deg = m.deg
                val max = StoryLimits.SWAY_MAX_DEG
                if (deg != null && abs(deg) > max + EPS) out += "sway deg must be within ±$max (got $deg)"
                atLeast(StoryLimits.PULSE_MIN_MS)
            }
            MotionType.GLOW -> atLeast(StoryLimits.PULSE_MIN_MS)
            MotionType.PATH -> {
                val n = m.points.size
                if (n < StoryLimits.PATH_MIN_POINTS || n > StoryLimits.PATH_MAX_POINTS) {
                    out += "path needs ${StoryLimits.PATH_MIN_POINTS}–${StoryLimits.PATH_MAX_POINTS} points, has $n"
                }
                m.points.forEachIndexed { i, pt ->
                    if (pt.size != 2 || pt.any { it !in 0.0..1.0 }) out += "path point $i must be [x, y] within 0..1 (got $pt)"
                }
                atMost(StoryLimits.LONG_MAX_MS)
            }
            MotionType.ZOOM -> {
                val from = m.effectiveScaleFrom()
                val to = m.effectiveScaleTo()
                val range = StoryLimits.ZOOM_MIN..StoryLimits.ZOOM_MAX
                if (from !in range || to !in range) {
                    out += "zoom scale_from and scale_to must be within ${StoryLimits.ZOOM_MIN}–${StoryLimits.ZOOM_MAX} (got $from, $to)"
                }
                atMost(StoryLimits.LONG_MAX_MS)
            }
            MotionType.REVEAL -> {
                atMost(StoryLimits.REVEAL_MAX_MS)
                m.from?.let { if (it !in MotionSide.REVEAL) out += "reveal from must be left or right (got $it)" }
            }
        }
        return out
    }

    private const val EPS = 1e-9

    private fun levelName(level: Level): String = level.name.lowercase()

    /** The catalog id of a motion type (`fade_in`), as authors write it. */
    private fun motionName(type: MotionType): String = type.name.lowercase()

    private fun checkClip(
        at: String,
        key: String?,
    ): PackProblem? = if (key != null && !isClipKey(key)) PackProblem(at, "audio clip key $key must look like <lang>/<slug>") else null

    /** The catalog id (`match_pairs`), as authors write it. */
    private fun typeName(type: ItemType): String = type.name.lowercase()

    private fun bare(text: String): String? = missingHarakat(text).takeIf { it.isNotEmpty() }?.joinToString(" ")

    private fun Region.near(o: Region): Boolean =
        kotlin.math.abs(x - o.x) < REGION_EPS && kotlin.math.abs(y - o.y) < REGION_EPS &&
            kotlin.math.abs(w - o.w) < REGION_EPS && kotlin.math.abs(h - o.h) < REGION_EPS

    private const val REGION_EPS = 0.02

    private fun checkText(
        path: String,
        text: LocalizedText,
        langs: List<Lang>,
    ): List<PackProblem> {
        val missing = langs.filter { text.resolve(it).isBlank() }
        return if (missing.isEmpty()) emptyList() else listOf(PackProblem(path, "missing ${missing.joinToString { it.tag }}"))
    }
}
