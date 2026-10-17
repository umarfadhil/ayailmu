package id.petalytix.ayailmu.feature.session

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Pool
import kotlin.random.Random

/** Content rules shared by Home and the session (one place, so "Resume" on Home matches what the session restores). */
object SessionContent {
    /** Only item types that have a v1 renderer reach a session (CR-ENG-5); v2 types wait for P6. */
    fun playable(content: GatedContent): GatedContent {
        val items = content.items.filter { it.type.isV1 }
        return content.copy(items = items, empty = items.isEmpty())
    }

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

/** How a step is drawn. One renderer per kind; the catalog type picks the kind (CR-ENG-5). */
enum class RenderKind { CHOICE, TYPED, PARAPHRASE, NUMBER, SEQUENCE, PAIRS, BUCKETS, INFO, GEM, UNSUPPORTED }

data class OptionUi(
    val id: String,
    val text: String?,
    val target: String?,
    val image: String?,
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
    ) : StepUi
}

/** Pure mapping from engine state + content to what the screen draws. No Android types, unit-tested. */
object StepMapper {
    fun kindOf(item: Item): RenderKind =
        when {
            // Only card-type gems are "seen" cards; a gem written as a question keeps its own renderer.
            item.type == ItemType.INFO_CARD || item.type == ItemType.MINI_READING ->
                if (item.gem || item.pool == Pool.GEM) RenderKind.GEM else RenderKind.INFO
            item.isParaphrase -> RenderKind.PARAPHRASE
            item.isTyped -> RenderKind.TYPED
            item.type == ItemType.NUMBER_INPUT -> RenderKind.NUMBER
            item.isSequence -> RenderKind.SEQUENCE
            item.type == ItemType.SORT_BUCKETS -> RenderKind.BUCKETS
            item.isPairs -> RenderKind.PAIRS
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

    private fun question(
        item: Item,
        role: Step.Role,
        content: GatedContent,
        lang: Lang,
        targetLang: String?,
    ): StepUi.Question {
        val kind = kindOf(item)
        val options = item.options.map { OptionUi(it.id, it.text?.resolve(lang), it.targetText, it.image) }
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
            else -> {
                left = emptyList()
                right = emptyList()
            }
        }
        val reading = item.readingId?.let { content.readings[it] }
        return StepUi.Question(
            itemId = item.itemId,
            kind = kind,
            role = role,
            prompt = content.prompts[item.promptId]?.resolve(lang).orEmpty(),
            target = item.targetText,
            help = item.helpLines.map { HelpUi(word = if (targetLang != null) it.word else null, meaning = it.meaning.resolve(lang)) },
            options = if (kind == RenderKind.CHOICE || kind == RenderKind.SEQUENCE) options else emptyList(),
            left = left,
            right = right,
            slots = if (kind == RenderKind.SEQUENCE) item.solution.size else 0,
            unitLabel = item.numeric?.unit?.resolve(lang),
            reading =
                reading?.let { r ->
                    ReadingUi(title = r.title?.resolve(lang), target = r.targetText, body = r.body.map { it.resolve(lang) })
                },
            cardText = if (kind == RenderKind.GEM || kind == RenderKind.INFO) item.modelAnswer?.resolve(lang) else null,
            audioMissing = item.type == ItemType.AUDIO_MATCH,
            lang = lang,
        )
    }
}
