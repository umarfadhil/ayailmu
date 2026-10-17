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
    val items: List<Item> = emptyList(),
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
    /** Asset path for `pick_image` options (hand-drawn, ART_DIRECTION). */
    val image: String? = null,
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
    val audio: String? = null,
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
        get() = type == ItemType.CHOOSE || type == ItemType.PICK_IMAGE || type == ItemType.TRUE_FALSE || type == ItemType.AUDIO_MATCH
    val isReferentChoice: Boolean get() = isChoiceFamily && variant == VARIANT_REFERENT
    val isSequence: Boolean get() = type == ItemType.ORDER || type == ItemType.TILES || type == ItemType.FILL_BLANK
    val isPairs: Boolean get() = type == ItemType.MATCH_PAIRS || type == ItemType.SORT_BUCKETS
    val primarySkill: String? get() = skills.firstOrNull()

    companion object {
        const val VARIANT_MEANING = "meaning"
        const val VARIANT_PARAPHRASE = "paraphrase"
        const val VARIANT_FORM = "form"
        const val VARIANT_REFERENT = "referent"
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
