package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Pool

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
 */
object PackValidator {
    const val SUPPORTED_SCHEMA_VERSION = 1

    private val ARABIC_LETTER = Regex("[\\u0621-\\u064A\\u0671-\\u06D3]")
    private val HARAKAT = Regex("[\\u064B-\\u0652]")
    private val SPLIT = Regex("[\\s.,:؛،!?«»\"()]+")

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

    fun validate(pack: ContentPack): List<PackProblem> {
        val p = mutableListOf<PackProblem>()
        p += validateMeta(pack.meta)
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

        val ids = HashSet<String>()
        for (item in pack.items) {
            val id = item.itemId
            if (!ids.add(id)) p += PackProblem(id, "duplicate item_id")
            if (!item.constructed && arabic) p += PackProblem(id, "constructed must be true in the Arabic track")
            if (!pack.prompts.containsKey(item.promptId)) p += PackProblem(id, "unknown prompt_id ${item.promptId}")
            if (item.contentVersion != version) p += PackProblem(id, "content_version mismatch")
            if (item.gem && item.source.isNullOrBlank()) p += PackProblem(id, "gem items need a source")
            if (item.gem && item.pool != Pool.GEM && item.type != ItemType.INFO_CARD) {
                p += PackProblem(id, "gem flag belongs on GEM-pool or info_card items")
            }
            item.readingId?.let { if (!pack.readings.containsKey(it)) p += PackProblem(id, "unknown reading_id $it") }
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
                    if (item.type == ItemType.AUDIO_MATCH && item.options.any { it.text == null && it.targetText == null }) {
                        p += PackProblem(id, "audio_match options need text")
                    }
                    item.options.forEach { o ->
                        o.text?.let { p += checkText("$id.option.${o.id}", it, langs) }
                        o.feedbackId?.let { fid -> if (!pack.feedback.containsKey(fid)) p += PackProblem(id, "unknown feedback id $fid") }
                    }
                    if (item.isReferentChoice && item.referent == null) p += PackProblem(id, "referent choice needs a referent")
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
                item.type == ItemType.NUMBER_INPUT || item.type == ItemType.ESTIMATE_SLIDER -> {
                    if (item.numeric == null) p += PackProblem(id, "numeric item needs a numeric answer")
                    if (item.type == ItemType.ESTIMATE_SLIDER && (item.numeric?.tolerance ?: 0.0) <= 0.0) {
                        p += PackProblem(id, "estimate_slider needs a tolerance band")
                    }
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
                    item.options.forEach { o -> o.text?.let { p += checkText("$id.option.${o.id}", it, langs) } }
                }
                item.type == ItemType.MINI_READING -> {
                    if (item.readingId == null) p += PackProblem(id, "mini_reading needs a reading_id")
                }
                item.type == ItemType.INFO_CARD -> Unit
                else -> Unit // v2 renderer types validated when their renderers land (P6)
            }

            if (item.pool == Pool.FOCUS && item.focusFor == null) p += PackProblem(id, "FOCUS item needs focus_for")
            if (item.pool == Pool.GEM && !item.gem) p += PackProblem(id, "GEM-pool item must set gem=true")
            if (item.type == ItemType.AUDIO_MATCH && item.audio.isNullOrBlank()) p += PackProblem(id, "audio_match needs an audio asset")
        }
        return p
    }

    private fun bare(text: String): String? = missingHarakat(text).takeIf { it.isNotEmpty() }?.joinToString(" ")

    private fun checkText(
        path: String,
        text: LocalizedText,
        langs: List<Lang>,
    ): List<PackProblem> {
        val missing = langs.filter { text.resolve(it).isBlank() }
        return if (missing.isEmpty()) emptyList() else listOf(PackProblem(path, "missing ${missing.joinToString { it.tag }}"))
    }
}
