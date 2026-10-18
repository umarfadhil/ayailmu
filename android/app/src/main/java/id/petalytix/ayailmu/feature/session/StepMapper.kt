package id.petalytix.ayailmu.feature.session

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import id.petalytix.ayailmu.feature.session.story.StoryUi
import id.petalytix.ayailmu.feature.session.story.StoryUiMapper
import kotlin.random.Random

/** Content rules shared by Home and the session (one place, so "Resume" on Home matches what the session restores). */
object SessionContent {
    /**
     * What a session may serve: item types that have a renderer (CR-ENG-5), never daily puzzles (pool SPARE,
     * Home only), and only units this learner has unlocked ([unlocked] null = every unit, e.g. tests and the
     * developer demo; see store/AccessPolicy). Lesson screens follow their unit.
     */
    fun playable(
        content: GatedContent,
        unlocked: ((String) -> Boolean)? = null,
    ): GatedContent {
        val open: (String) -> Boolean = unlocked ?: { _ -> true }
        val items = content.items.filter { it.type.isV1 && it.pool != Pool.SPARE && open(it.unit) }
        val screens = content.screens.filter { open(it.unit) }
        return content.copy(items = items, screens = screens, empty = items.isEmpty())
    }

    /** Daily puzzles of a track (Home), whatever is unlocked: the puzzle is a free daily habit hook. */
    fun dailyPuzzles(content: GatedContent): List<Item> = content.items.filter { it.type == ItemType.DAILY_PUZZLE && it.pool == Pool.SPARE }

    /** A saved session is resumed only on the same calendar day, for the same learner, if it is unfinished. */
    fun canResume(
        s: SessionState,
        learnerId: String,
        today: String,
    ): Boolean = s.learnerId == learnerId && s.localDate == today && s.phase != SessionState.Phase.DONE

    /**
     * Session length: the profile's choice snapped to the nearest length this track offers (evidence and casual
     * tracks offer different lengths, CR-HAB-1), or the track's default when the profile left it on automatic.
     */
    fun budgetMinutes(
        profileMinutes: Int?,
        rules: RuleConfig,
    ): Int =
        profileMinutes?.let { m -> rules.sessionMinutesOptions.minByOrNull { kotlin.math.abs(it - m) } }
            ?: rules.defaultSessionMinutes
}

/**
 * How a step is drawn. One renderer per kind; the catalog type picks the kind (CR-ENG-5). Within PAIRS, BUCKETS
 * and SEQUENCE the question's gesture picks the interaction (connect, drag or tap; INTERACTIONS_AUDIO.md 2.1);
 * audio_match is a CHOICE with [StepUi.Question.listen] set. STORY (follow-up 12) is the animated story player:
 * seen, never scored, like INFO.
 */
enum class RenderKind {
    CHOICE,
    TYPED,
    PARAPHRASE,
    NUMBER,
    SLIDER,
    SEQUENCE,
    PAIRS,
    BUCKETS,
    MEMORY,
    HOTSPOT,
    INFO,
    GEM,
    TRACE,
    STORY,
    UNSUPPORTED,
}

/** A tap area on a picture, as fractions of the picture (origin top-left), copied from docs/ART_CATALOG.md. */
data class RegionUi(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
)

data class OptionUi(
    val id: String,
    val text: String?,
    val target: String?,
    /** Art key (docs/ART_CATALOG.md), drawn by ArtImage. */
    val image: String?,
    /** HOTSPOT: where this option sits on the item picture. */
    val region: RegionUi? = null,
    /** Clip key (`<lang>/<slug>`): a speaker button on the card, hidden while the clip is not on the phone. */
    val audio: String? = null,
    /** Reading aid shown small under [target] (pinyin, romaji, Revised Romanization). */
    val romanization: String? = null,
)

/** ESTIMATE_SLIDER: the range the learner slides over. */
data class SliderUi(
    val min: Double,
    val max: Double,
    val step: Double,
) {
    /** Snaps a raw slider position to the nearest step inside the range. */
    fun snap(raw: Double): Double {
        val steps = kotlin.math.round((raw - min) / step)
        return (min + steps * step).coerceIn(min, max)
    }
}

/**
 * MEMORY: one face-down card. Cards that belong together share [pairKey] (the left option id); [left] tells
 * the two halves apart. Practice only (memory_flip never produces evidence), so the pairing may live in the UI.
 */
data class MemoryCardUi(
    val cardId: String,
    val option: OptionUi,
    val pairKey: String,
    val left: Boolean,
)

/** A help line. [word] is target-language text (shown only for language tracks). */
data class HelpUi(
    val word: String?,
    val meaning: String,
)

data class ExampleUi(
    val target: String?,
    val gloss: String,
)

data class ReadingUi(
    val title: String?,
    val target: String?,
    val body: List<String>,
)

sealed interface StepUi {
    data class Screen(
        val screenId: String,
        val title: String,
        val body: List<String>,
        val examples: List<ExampleUi>,
        /** Index of the paragraph drawn as a clue box (0-based, validated by PackValidator). */
        val clueIndex: Int?,
    ) : StepUi

    data class Question(
        val itemId: String,
        val kind: RenderKind,
        val role: Step.Role,
        val prompt: String,
        val target: String?,
        val help: List<HelpUi>,
        /** CHOICE and SEQUENCE: the options, in pack order (sequence tiles are shuffled by the pack author). */
        val options: List<OptionUi> = emptyList(),
        /** PAIRS / BUCKETS: what gets placed (left) and where it goes (right). */
        val left: List<OptionUi> = emptyList(),
        val right: List<OptionUi> = emptyList(),
        /** SEQUENCE: how many tiles the answer needs. */
        val slots: Int = 0,
        val unitLabel: String? = null,
        val reading: ReadingUi? = null,
        /** GEM / INFO: the card text (model answer). */
        val cardText: String? = null,
        /** Audio items without a playable clip are answered as "audio unavailable" (never the learner's fault). */
        val audioMissing: Boolean = false,
        /** Instruction language; decides how a typed number is read ("2,5" vs "2.5"). */
        val lang: Lang = Lang.ID,
        /** Picture shown with the question (art key); HOTSPOT draws its tap areas on it. */
        val image: String? = null,
        val slider: SliderUi? = null,
        /** MEMORY: the cards, shuffled once per item (stable on resume). */
        val cards: List<MemoryCardUi> = emptyList(),
        /**
         * PAIRS, BUCKETS, SEQUENCE: how the learner answers (`Gestures`: connect, drag or tap), already resolved to
         * the type's default when the item leaves it out; null for every other kind. Tap-then-tap always works too.
         */
        val gesture: String? = null,
        /** Clip key of the item: what the listen button plays (audio_match), else a speaker beside the target text. */
        val audio: String? = null,
        /** audio_match: a big listen button above the options (pictures or text), played once when the question appears. */
        val listen: Boolean = false,
        /** Reading aid shown small under [target]. */
        val romanization: String? = null,
        /** TRACE: the stroke key (`assets/strokes/index.json`, provided as LocalStrokes). */
        val trace: String? = null,
        /** The track's target language ("en", "ko", "ja", "zh", "ar"); null outside language tracks. */
        val targetLang: String? = null,
        /** fill_blank: index into [help] of the sentence with the gap ("____"), drawn with the drop place inside it. */
        val blankLine: Int? = null,
        /** fill_blank: the gap is in [target] (language tracks: "I ___ like fish.", "＿＿が すき！"). */
        val blankInTarget: Boolean = false,
        /**
         * STORY: the story to play. Any other kind: the story the question is about (`story_id`), which the session
         * offers again with «Lihat cerita lagi». Null when there is none or it is not visible in this build.
         */
        val story: StoryUi? = null,
    ) : StepUi
}

/** Pure mapping from engine state + content to what the screen draws. No Android types, unit-tested. */
object StepMapper {
    fun kindOf(item: Item): RenderKind =
        when {
            // A story is watched and "seen" (MODULES_LEVELS_STORIES.md section 2); never a question, never evidence.
            item.isStory -> RenderKind.STORY
            // Only card-type gems are "seen" cards; a gem written as a question keeps its own renderer.
            item.type == ItemType.INFO_CARD || item.type == ItemType.MINI_READING ->
                if (item.gem || item.pool == Pool.GEM) RenderKind.GEM else RenderKind.INFO
            item.isParaphrase -> RenderKind.PARAPHRASE
            item.isTyped -> RenderKind.TYPED
            item.type == ItemType.ESTIMATE_SLIDER -> if (item.slider != null) RenderKind.SLIDER else RenderKind.NUMBER
            item.isNumeric -> RenderKind.NUMBER
            item.isSequence -> RenderKind.SEQUENCE
            item.type == ItemType.SORT_BUCKETS -> RenderKind.BUCKETS
            item.type == ItemType.MEMORY_FLIP -> RenderKind.MEMORY
            item.isTrace -> RenderKind.TRACE
            item.isPairs -> RenderKind.PAIRS
            // A tap item without its picture falls back to plain choices (the validator rejects that anyway).
            item.type == ItemType.TAP_HOTSPOT && item.image != null -> RenderKind.HOTSPOT
            item.isChoiceFamily -> RenderKind.CHOICE
            else -> RenderKind.UNSUPPORTED
        }

    fun map(
        state: SessionState,
        content: GatedContent,
        lang: Lang,
        targetLang: String?,
    ): StepUi? {
        val step = state.currentStep ?: return null
        return when (step.kind) {
            Step.Kind.SCREEN -> {
                val screen = content.screens.firstOrNull { it.screenId == step.id } ?: return null
                StepUi.Screen(
                    screenId = screen.screenId,
                    title = screen.title.resolve(lang),
                    body = screen.body.map { it.resolve(lang) },
                    examples = screen.examples.map { ExampleUi(it.targetText, it.gloss.resolve(lang)) },
                    clueIndex = screen.clueParagraph,
                )
            }
            Step.Kind.ITEM -> content.itemOrNull(step.id)?.let { question(it, step.role, content, lang, targetLang) }
        }
    }

    /** One item as a question, outside a session (daily puzzle, speed round). */
    fun question(
        item: Item,
        role: Step.Role,
        content: GatedContent,
        lang: Lang,
        targetLang: String?,
    ): StepUi.Question {
        val kind = kindOf(item)
        val options =
            item.options.map { o ->
                OptionUi(
                    id = o.id,
                    text = o.text?.resolve(lang),
                    target = o.targetText,
                    image = o.image,
                    region = o.region?.let { RegionUi(it.x.toFloat(), it.y.toFloat(), it.w.toFloat(), it.h.toFloat()) },
                    audio = o.audio,
                    romanization = o.romanization,
                )
            }
        val byId = options.associateBy { it.id }
        val left: List<OptionUi>
        val right: List<OptionUi>
        when (kind) {
            RenderKind.PAIRS -> {
                left = item.solutionPairs.keys.mapNotNull { byId[it] }
                // Stable shuffle per item so the right column never lines up with the left, and stays put on resume.
                right = item.solutionPairs.values.distinct().mapNotNull { byId[it] }.shuffled(Random(item.itemId.hashCode()))
            }
            RenderKind.BUCKETS -> {
                val buckets = item.solutionPairs.values.toSet()
                left = item.solutionPairs.keys.mapNotNull { byId[it] }
                right = options.filter { it.id in buckets }
            }
            RenderKind.MEMORY -> {
                left = item.solutionPairs.keys.mapNotNull { byId[it] }
                right = item.solutionPairs.values.mapNotNull { byId[it] }
            }
            else -> {
                left = emptyList()
                right = emptyList()
            }
        }
        val reading = item.readingId?.let { content.readings[it] }
        // A blank word (language packs use "" for a hint with no target text) is no word: no empty target line above it.
        val helpLines =
            item.helpLines.map { h ->
                HelpUi(word = h.word.takeIf { targetLang != null && it.isNotBlank() }, meaning = h.meaning.resolve(lang))
            }
        val listen = item.type == ItemType.AUDIO_MATCH
        val usesGesture = kind == RenderKind.PAIRS || kind == RenderKind.BUCKETS || kind == RenderKind.SEQUENCE
        val gapInTarget = item.type == ItemType.FILL_BLANK && SlotBoard.hasBlank(item.targetText)
        return StepUi.Question(
            itemId = item.itemId,
            kind = kind,
            role = role,
            prompt = content.prompts[item.promptId]?.resolve(lang).orEmpty(),
            target = item.targetText,
            help = helpLines,
            options = if (kind == RenderKind.CHOICE || kind == RenderKind.SEQUENCE || kind == RenderKind.HOTSPOT) options else emptyList(),
            left = left,
            right = right,
            slots = if (kind == RenderKind.SEQUENCE) item.solution.size else 0,
            unitLabel = item.numeric?.unit?.resolve(lang),
            reading =
                reading?.let { r ->
                    ReadingUi(title = r.title?.resolve(lang), target = r.targetText, body = r.body.map { it.resolve(lang) })
                },
            cardText = if (kind == RenderKind.GEM || kind == RenderKind.INFO) item.modelAnswer?.resolve(lang) else null,
            // A listening item whose clip key is missing; a key whose file is not on the phone is found by the UI.
            audioMissing = listen && item.audio.isNullOrBlank(),
            lang = lang,
            image = item.image,
            slider = if (kind == RenderKind.SLIDER) item.slider?.let { SliderUi(it.min, it.max, it.step) } else null,
            cards = if (kind == RenderKind.MEMORY) memoryCards(item, byId) else emptyList(),
            gesture = if (usesGesture) item.effectiveGesture else null,
            audio = item.audio,
            listen = listen,
            romanization = item.romanization,
            trace = if (kind == RenderKind.TRACE) item.trace else null,
            targetLang = targetLang,
            blankLine = if (item.type == ItemType.FILL_BLANK && !gapInTarget) blankLine(helpLines) else null,
            blankInTarget = gapInTarget,
            story = story(item, content, lang),
        )
    }

    /** The story a `story` item plays, or the one a question is about, resolved for [lang]. */
    private fun story(
        item: Item,
        content: GatedContent,
        lang: Lang,
    ): StoryUi? {
        val id = item.storyId?.takeIf { it.isNotBlank() } ?: return null
        return content.story(id)?.let { StoryUiMapper.map(id, it, lang) }
    }

    /** The help line holding the gap of a fill_blank sentence, if there is one. */
    private fun blankLine(help: List<HelpUi>): Int? = help.indexOfFirst { SlotBoard.hasBlank(it.meaning) }.takeIf { it >= 0 }

    /** Both halves of every pair as cards, shuffled with a seed from the item id (same layout after a resume). */
    private fun memoryCards(
        item: Item,
        byId: Map<String, OptionUi>,
    ): List<MemoryCardUi> =
        item.solutionPairs
            .flatMap { (l, r) ->
                listOfNotNull(
                    byId[l]?.let { MemoryCardUi("L-$l", it, pairKey = l, left = true) },
                    byId[r]?.let { MemoryCardUi("R-$r", it, pairKey = l, left = false) },
                )
            }.shuffled(Random(item.itemId.hashCode()))
}
