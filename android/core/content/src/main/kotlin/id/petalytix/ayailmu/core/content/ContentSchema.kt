package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.ReviewStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Content pack schema v1 (`content/packs/<subject>/<track>/v<N>.json`, CR-ENG-1, framework §7).
 * Generalises the trial prototype's format: every learner-facing string is a [LocalizedText]; the learner's
 * instruction language picks which half is shown (CR-I18N-1/2). Target-language text (Arabic) is a separate
 * `target_text` field so fonts and RTL apply per field (CR-I18N-3).
 */
@Serializable
data class ContentPack(
    val meta: PackMeta,
    /** True for made-up developer fixtures. Never shown in `prod` (CR-ENG-2). */
    val synthetic: Boolean = false,
    val note: String? = null,
    val prompts: Map<String, LocalizedText> = emptyMap(),
    val feedback: Map<String, LocalizedText> = emptyMap(),
    val screens: List<LessonScreen> = emptyList(),
    val readings: Map<String, Reading> = emptyMap(),
    /** P6: unit titles and the sticker each completed unit awards (art key). Empty = units are untitled. */
    val units: List<UnitInfo> = emptyList(),
    val items: List<Item> = emptyList(),
    /** Follow-up 12: animated stories by id ([Story]); each is played by a `story` item with that `story_id`. */
    val stories: Map<String, Story> = emptyMap(),
)

/** One unit of a pack. [sticker] is an art key (`content/assets/art/index.json`) awarded when the unit is done. */
@Serializable
data class UnitInfo(
    val unit: String,
    val title: LocalizedText,
    val sticker: String? = null,
)

/**
 * A tappable area of an item's [Item.image] for `tap_hotspot`, as fractions of the picture (0..1, origin top-left).
 * Regions are published per art key in `art/index.json` so packs and drawings agree.
 */
@Serializable
data class Region(
    val x: Double,
    val y: Double,
    val w: Double,
    val h: Double,
) {
    fun contains(
        px: Double,
        py: Double,
    ): Boolean = px >= x && px <= x + w && py >= y && py <= y + h

    val isValid: Boolean get() = x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0 + 1e-9 && y + h <= 1.0 + 1e-9
}

/** Range of an `estimate_slider`. The answer and its tolerance live in [Item.numeric]. */
@Serializable
data class SliderSpec(
    val min: Double,
    val max: Double,
    val step: Double = 1.0,
)

@Serializable
data class HelpLine(
    val word: String,
    val meaning: LocalizedText,
)

@Serializable
data class ChoiceOption(
    val id: String,
    /** Instruction-language text; null when the option is pure target text or an image. */
    val text: LocalizedText? = null,
    /** Target-language text (rendered with the target font / direction). */
    @SerialName("target_text") val targetText: String? = null,
    /** Art key for `pick_image` options (`art/index.json`; hand-drawn, ART_DIRECTION). */
    val image: String? = null,
    /** `tap_hotspot`: where this option sits on the item's picture. */
    val region: Region? = null,
    /** Clip key (`<lang>/<slug>`, INTERACTIONS_AUDIO.md §3.1): a speaker button on this card. Hidden until the clip exists. */
    val audio: String? = null,
    /** Reading aid shown small under [targetText] (pinyin, romaji, Revised Romanization). */
    val romanization: String? = null,
    val correct: Boolean = false,
    @SerialName("error_tag") val errorTag: ErrorTag? = null,
    @SerialName("feedback_id") val feedbackId: String? = null,
) {
    init {
        require(text != null || targetText != null || image != null) { "option $id has no content" }
    }
}

@Serializable
data class KnownError(
    /** Normalised phrase that, when present, makes the typed answer a known wrong answer. */
    val pattern: String,
    val tag: ErrorTag,
    @SerialName("feedback_id") val feedbackId: String,
    val serious: Boolean = false,
)

@Serializable
data class PendingTerm(
    val term: String,
    @SerialName("feedback_id") val feedbackId: String,
)

/** Accepted typed answers for one instruction language. */
@Serializable
data class AcceptedAnswers(
    val terms: List<String>,
    @SerialName("pending_terms") val pendingTerms: List<PendingTerm> = emptyList(),
    @SerialName("known_errors") val knownErrors: List<KnownError> = emptyList(),
)

/** Numeric answer for `number_input` / `estimate_slider`. */
@Serializable
data class NumericAnswer(
    val value: Double,
    /** Absolute tolerance; 0 = exact. Estimate items use a wider band. */
    val tolerance: Double = 0.0,
    val unit: LocalizedText? = null,
)

@Serializable
data class FocusFor(
    val tag: ErrorTag,
    val referent: Referent? = null,
)

/**
 * `variant` refines scoring within a catalog type: `type_in` → `meaning` (one word/phrase) or `paraphrase`
 * (sentence meaning + referent, scored in three parts); `choose` → `form`, `referent` or plain.
 */
@Serializable
data class Item(
    @SerialName("item_id") val itemId: String,
    val unit: String,
    val type: ItemType,
    val variant: String? = null,
    val audience: Audience? = null,
    val level: Level? = null,
    val step: Int? = null,
    val skills: List<String> = emptyList(),
    val pool: Pool,
    @SerialName("target_text") val targetText: String? = null,
    val constructed: Boolean = true,
    @SerialName("help_lines") val helpLines: List<HelpLine> = emptyList(),
    @SerialName("prompt_id") val promptId: String,
    val options: List<ChoiceOption> = emptyList(),
    /** Keyed by instruction language tag ("id", "en"). */
    val accepted: Map<String, AcceptedAnswers> = emptyMap(),
    val numeric: NumericAnswer? = null,
    /** Correct order of option ids for `order`/`tiles`/`fill_blank`. */
    val solution: List<String> = emptyList(),
    /** Correct pairs for `match_pairs`/`sort_buckets` as option-id pairs (left → right). */
    @SerialName("solution_pairs") val solutionPairs: Map<String, String> = emptyMap(),
    val referent: Referent? = null,
    @SerialName("model_answer") val modelAnswer: LocalizedText? = null,
    @SerialName("word_id") val wordId: String? = null,
    @SerialName("word_meaning") val wordMeaning: LocalizedText? = null,
    @SerialName("feedback_ids") val feedbackIds: Map<String, String> = emptyMap(),
    val forms: List<String> = emptyList(),
    @SerialName("reserve_forms") val reserveForms: Boolean = false,
    @SerialName("later_day") val laterDay: Boolean = false,
    @SerialName("focus_for") val focusFor: FocusFor? = null,
    val order: Int? = null,
    @SerialName("reading_id") val readingId: String? = null,
    /** Clip key (`<lang>/<slug>`, INTERACTIONS_AUDIO.md §3.1): what an `audio_match` plays; a speaker elsewhere. */
    val audio: String? = null,
    /** Art key shown with the question (a picture to count, the scene of a `tap_hotspot`). */
    val image: String? = null,
    /** `estimate_slider` range. */
    val slider: SliderSpec? = null,
    /** How a pair/sequence item is answered ([Gestures]); null = the type's default. */
    val gesture: String? = null,
    /** Reading aid shown small under [targetText] (pinyin with tone marks, Hepburn romaji, Revised Romanization). */
    val romanization: String? = null,
    /** `trace`: the stroke key (`assets/strokes/index.json`, [StrokeIndex]) of the glyph to trace. */
    val trace: String? = null,
    /**
     * Follow-up 12: on a `story` item, the story it plays (`ContentPack.stories`); on any other item, the story the
     * question is about (the app offers «Lihat lagi / Watch again»).
     */
    @SerialName("story_id") val storyId: String? = null,
    val gem: Boolean = false,
    /** Required when `gem` is true (framework §1b). */
    val source: String? = null,
    @SerialName("review_status") val reviewStatus: ReviewStatus = ReviewStatus.DRAFT,
    @SerialName("content_version") val contentVersion: String,
) {
    val isTyped: Boolean get() = type == ItemType.TYPE_IN
    val isParaphrase: Boolean get() = type == ItemType.TYPE_IN && variant == VARIANT_PARAPHRASE
    val isMeaning: Boolean get() = type == ItemType.TYPE_IN && variant != VARIANT_PARAPHRASE
    val isChoiceFamily: Boolean
        get() =
            type == ItemType.CHOOSE ||
                type == ItemType.PICK_IMAGE ||
                type == ItemType.TRUE_FALSE ||
                type == ItemType.AUDIO_MATCH ||
                type == ItemType.TAP_HOTSPOT ||
                type == ItemType.STORY_CHOICE ||
                (type == ItemType.DAILY_PUZZLE && options.isNotEmpty())

    /** Answered with a number: number pad, estimate slider, or a daily puzzle without options. */
    val isNumeric: Boolean
        get() = type == ItemType.NUMBER_INPUT || type == ItemType.ESTIMATE_SLIDER || (type == ItemType.DAILY_PUZZLE && options.isEmpty())
    val isReferentChoice: Boolean get() = isChoiceFamily && variant == VARIANT_REFERENT
    val isSequence: Boolean get() = type == ItemType.ORDER || type == ItemType.TILES || type == ItemType.FILL_BLANK
    val isPairs: Boolean get() = type == ItemType.MATCH_PAIRS || type == ItemType.SORT_BUCKETS || type == ItemType.MEMORY_FLIP

    /** Traced letter: answered with the ids of the completed strokes, never wrong, never evidence. */
    val isTrace: Boolean get() = type == ItemType.TRACE

    /** Animated story: tapped through and "seen", never scored, never evidence (like `info_card`). */
    val isStory: Boolean get() = type == ItemType.STORY

    /** The gesture the renderer uses: [gesture] when set, else the type's default (null = the type has none). */
    val effectiveGesture: String? get() = gesture ?: Gestures.defaultFor(type)
    val primarySkill: String? get() = skills.firstOrNull()

    companion object {
        const val VARIANT_MEANING = "meaning"
        const val VARIANT_PARAPHRASE = "paraphrase"
        const val VARIANT_FORM = "form"
        const val VARIANT_REFERENT = "referent"
    }
}

/**
 * How pair and sequence items are answered (INTERACTIONS_AUDIO.md §2.1). Every drag or connect also works
 * tap-then-tap for accessibility; the gesture only picks the main interaction.
 */
object Gestures {
    /** Draw a line from a left card to its partner. */
    const val CONNECT = "connect"

    /** Drag a card onto its target, slot or basket. */
    const val DRAG = "drag"

    /** Tap a card, then tap its place (the pre-follow-up-11 interaction). */
    const val TAP = "tap"

    val ALL: Set<String> = setOf(CONNECT, DRAG, TAP)

    /** Gestures an item of [type] may declare; empty = `gesture` must be absent. */
    fun allowedFor(type: ItemType): Set<String> =
        when (type) {
            ItemType.MATCH_PAIRS -> setOf(CONNECT, DRAG)
            ItemType.SORT_BUCKETS -> setOf(DRAG)
            ItemType.ORDER, ItemType.TILES, ItemType.FILL_BLANK -> setOf(DRAG, TAP)
            else -> emptySet()
        }

    /** Renderer default when an item leaves `gesture` out. */
    fun defaultFor(type: ItemType): String? =
        when (type) {
            ItemType.MATCH_PAIRS -> CONNECT
            ItemType.SORT_BUCKETS, ItemType.ORDER, ItemType.TILES, ItemType.FILL_BLANK -> DRAG
            else -> null
        }
}

@Serializable
data class LessonExample(
    @SerialName("target_text") val targetText: String? = null,
    val gloss: LocalizedText,
)

@Serializable
data class LessonScreen(
    @SerialName("screen_id") val screenId: String,
    val unit: String,
    val audience: Audience? = null,
    val title: LocalizedText,
    val body: List<LocalizedText>,
    val examples: List<LessonExample> = emptyList(),
    @SerialName("clue_paragraph") val clueParagraph: Int? = null,
    @SerialName("review_status") val reviewStatus: ReviewStatus = ReviewStatus.DRAFT,
)

/** A mini-reading passage; its questions are ordinary items with `reading_id` set. */
@Serializable
data class Reading(
    val title: LocalizedText? = null,
    @SerialName("target_text") val targetText: String? = null,
    val body: List<LocalizedText> = emptyList(),
    val label: LocalizedText? = null,
    @SerialName("review_status") val reviewStatus: ReviewStatus = ReviewStatus.DRAFT,
)

/** Convenience: resolve a bilingual map entry or fall back to the id itself (never silently empty). */
fun Map<String, LocalizedText>.resolve(
    id: String?,
    lang: Lang,
): String? = id?.let { this[it]?.resolve(lang) }
