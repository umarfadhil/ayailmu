package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.AcceptedAnswers
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.content.KnownError
import id.petalytix.ayailmu.core.model.AudioStatus
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.PartScore
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
import java.text.Normalizer
import kotlin.math.abs

/**
 * Answer scoring (Trial_App_Spec §5, lessons §2.6), ported from the prototype and extended for casual item
 * types. Typed answers are never auto-marked wrong unless they clearly match a known error; everything
 * unclear is `pending` (waiting for human check) and counts neither way (CR-ENG-7).
 */
object Text {
    private val APOSTROPHES = Regex("['’`]")
    private val NON_WORD = Regex("[^\\p{L}\\p{N}\\s]")
    private val SPACES = Regex("\\s+")

    fun normalize(text: String): String =
        Normalizer
            .normalize(text, Normalizer.Form.NFKC)
            .lowercase()
            .replace(APOSTROPHES, "")
            .replace(NON_WORD, " ")
            .replace(SPACES, " ")
            .trim()

    fun tokens(text: String): List<String> = normalize(text).split(' ').filter { it.isNotEmpty() }

    fun levenshtein(
        a: String,
        b: String,
    ): Int {
        if (a == b) return 0
        val prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            var diag = prev[0]
            prev[0] = i
            for (j in 1..b.length) {
                val tmp = prev[j]
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                prev[j] = minOf(prev[j] + 1, prev[j - 1] + 1, diag + cost)
                diag = tmp
            }
        }
        return prev[b.length]
    }
}

data class TypedScore(
    val status: Outcome,
    val matched: String? = null,
    /** Generic possession/action flags (held for human check). */
    val flags: List<ErrorTag> = emptyList(),
    val knownError: KnownError? = null,
    val feedbackId: String? = null,
    /** An accepted word appeared with a negation; held for human check. */
    val negated: Boolean = false,
)

data class ItemScore(
    val outcome: Outcome,
    val parts: Map<String, PartScore>,
    val errorTags: List<ErrorTag>,
    /** Serious mistake (blocks "learned" until resolved, spec §7). */
    val serious: ErrorTag?,
    val feedbackIds: List<String>,
)

object Scoring {
    private val NOMINALIZED = Regex("^ke[a-z]{3,}an(nya)?$")

    private fun tokenMatches(
        answer: String,
        term: String,
        rules: RuleConfig,
    ): Boolean {
        if (answer == term) return true
        val (minLen, maxEdits) = rules.typoTolerance
        return maxEdits > 0 &&
            term.length >= minLen &&
            abs(answer.length - term.length) <= maxEdits &&
            Text.levenshtein(answer, term) <= maxEdits
    }

    /** Finds `term` as a run of whole tokens. Returns the start index, or -1. */
    private fun findTerm(
        tokens: List<String>,
        term: String,
        rules: RuleConfig,
        typos: Boolean,
    ): Int {
        val termTokens = Text.tokens(term)
        if (termTokens.isEmpty()) return -1
        var i = 0
        while (i + termTokens.size <= tokens.size) {
            val ok =
                termTokens.withIndex().all { (k, t) ->
                    if (typos) tokenMatches(tokens[i + k], t, rules) else tokens[i + k] == t
                }
            if (ok) return i
            i++
        }
        return -1
    }

    private fun genericFlags(
        tokens: List<String>,
        typed: RuleConfig.TypedRules,
    ): List<ErrorTag> {
        val flags = mutableListOf<ErrorTag>()
        if (tokens.any { it in typed.possessionWords || NOMINALIZED.matches(it) }) flags += ErrorTag.POSSESSION
        if (tokens.any { it in typed.actionWords }) flags += ErrorTag.INVENTED_ACTION
        return flags
    }

    fun scoreTyped(
        raw: String,
        accepted: AcceptedAnswers,
        rules: RuleConfig,
        lang: Lang,
    ): TypedScore {
        val tokens = Text.tokens(raw)
        val typed = rules.typed(lang)

        for (k in accepted.knownErrors) {
            if (findTerm(tokens, k.pattern, rules, typos = false) >= 0) {
                return TypedScore(Outcome.WRONG, knownError = k, flags = listOf(k.tag), feedbackId = k.feedbackId)
            }
        }
        for (p in accepted.pendingTerms) {
            if (findTerm(tokens, p.term, rules, typos = false) >= 0) {
                return TypedScore(Outcome.PENDING, feedbackId = p.feedbackId)
            }
        }

        val flags = genericFlags(tokens, typed)
        var matched: String? = null
        var negated = false
        for (term in accepted.terms) {
            val at = findTerm(tokens, term, rules, typos = true)
            if (at < 0) continue
            val len = Text.tokens(term).size
            // Conservative: a negation anywhere outside the matched term may reverse the meaning; hold for check.
            val outside = tokens.subList(0, at) + tokens.subList(at + len, tokens.size)
            if (outside.any { it in typed.negationWords }) {
                negated = true
                continue
            }
            matched = term
            break
        }
        if (matched != null && !negated && flags.isEmpty()) return TypedScore(Outcome.CORRECT, matched = matched)
        return TypedScore(Outcome.PENDING, matched = if (negated) null else matched, negated = negated, flags = flags)
    }

    private fun pickOutcome(parts: Collection<PartScore>): Outcome =
        when {
            PartScore.WRONG in parts -> Outcome.WRONG
            parts.all { it == PartScore.CORRECT } -> Outcome.CORRECT
            parts.all { it == PartScore.DONT_KNOW } -> Outcome.DONT_KNOW
            else -> Outcome.PENDING
        }

    private fun refFeedback(referent: Referent): String = if (referent == Referent.PEREMPUAN) "FA-REF-HIYA" else "FA-REF-HUWA"

    private fun single(
        outcome: Outcome,
        part: String,
        score: PartScore,
        tags: List<ErrorTag> = emptyList(),
        serious: ErrorTag? = null,
        feedback: String? = null,
    ) = ItemScore(outcome, mapOf(part to score), tags, serious, listOfNotNull(feedback))

    fun scoreItem(
        item: Item,
        response: Response,
        rules: RuleConfig,
        lang: Lang,
    ): ItemScore {
        val fb = item.feedbackIds

        if (response.kind == Response.Kind.DONT_KNOW) {
            val parts =
                if (item.isParaphrase) {
                    mapOf("who" to PartScore.DONT_KNOW, "description" to PartScore.DONT_KNOW, "describes" to PartScore.DONT_KNOW)
                } else {
                    mapOf("answer" to PartScore.DONT_KNOW)
                }
            return ItemScore(Outcome.DONT_KNOW, parts, emptyList(), null, listOfNotNull(fb["dont_know"]))
        }

        if (item.type == ItemType.INFO_CARD || item.type == ItemType.MINI_READING || item.isStory) {
            // Not scored: the learner just continues. Gems are collected through the recorded event. A `story` is the
            // same kind of step (MODULES_LEVELS_STORIES.md section 2): watched, then "seen".
            return single(Outcome.NOT_ASSESSED, "seen", PartScore.NOT_ASSESSED, feedback = fb["correct"])
        }

        if (item.isTrace) {
            // Practice only (CR-ENG-9, INTERACTIONS_AUDIO.md section 4): the app checks each stroke loosely and lets the
            // learner retry it, then sends the ids of the strokes completed. Finishing is "done"; a trace is never wrong.
            require(response.kind == Response.Kind.SEQUENCE) { "${item.itemId}: trace item needs a sequence response" }
            return if (response.sequence.isNullOrEmpty()) {
                single(Outcome.NOT_ASSESSED, "answer", PartScore.NOT_ASSESSED)
            } else {
                single(Outcome.CORRECT, "answer", PartScore.CORRECT, feedback = fb["correct"])
            }
        }

        if (item.isMeaning) {
            val text = if (response.kind == Response.Kind.TYPED) response.text.orEmpty() else ""
            val acc = item.accepted[lang.tag] ?: AcceptedAnswers(emptyList())
            val t = scoreTyped(text, acc, rules, lang)
            val feedback = t.feedbackId ?: fb[t.status.key()]
            val tags = if (t.status == Outcome.WRONG) listOf(ErrorTag.LEXICAL) + t.flags.filter { it != ErrorTag.LEXICAL } else emptyList()
            return ItemScore(t.status, mapOf("meaning" to t.status.part()), tags, null, listOfNotNull(feedback))
        }

        if (item.isParaphrase) {
            require(response.kind == Response.Kind.TYPED) { "${item.itemId}: paraphrase needs a typed response" }
            val referent = requireNotNull(item.referent) { "${item.itemId}: paraphrase item has no referent" }
            val who =
                when (response.ref) {
                    null, Response.REF_DONT_KNOW -> PartScore.DONT_KNOW
                    Response.refTag(referent) -> PartScore.CORRECT
                    else -> PartScore.WRONG
                }
            val acc = item.accepted[lang.tag] ?: AcceptedAnswers(emptyList())
            val t = scoreTyped(response.text.orEmpty(), acc, rules, lang)
            // Parts follow the typed status: a pending (unclear/negated/flagged) answer is never upgraded to correct.
            val description =
                when {
                    t.knownError != null -> PartScore.WRONG
                    t.status == Outcome.CORRECT || (t.matched != null && !t.negated) -> PartScore.CORRECT
                    else -> PartScore.PENDING
                }
            val describes =
                when {
                    t.knownError != null -> PartScore.WRONG
                    t.status == Outcome.CORRECT -> PartScore.CORRECT
                    else -> PartScore.PENDING
                }
            val tags = mutableListOf<ErrorTag>()
            val feedback = mutableListOf<String>()
            var serious: ErrorTag? = null
            val known = t.knownError
            if (known != null) {
                tags += known.tag
                feedback += known.feedbackId
                if (known.serious) serious = known.tag
            } else {
                tags += t.flags
            }
            if (who == PartScore.WRONG) {
                tags += ErrorTag.WRONG_REFERENT
                feedback += refFeedback(referent)
                if (serious == null) serious = ErrorTag.WRONG_REFERENT
            }
            val parts = mapOf("who" to who, "description" to description, "describes" to describes)
            val outcome = pickOutcome(parts.values)
            if (outcome == Outcome.CORRECT) fb["correct"]?.let { feedback += it }
            if (outcome == Outcome.PENDING && feedback.isEmpty()) feedback += (t.feedbackId ?: fb["pending"] ?: "FA-PEND")
            return ItemScore(outcome, parts, tags, serious, feedback)
        }

        if (item.isNumeric) {
            require(response.kind == Response.Kind.NUMBER) { "${item.itemId}: numeric item needs a number response" }
            val numeric = requireNotNull(item.numeric) { "${item.itemId}: numeric item has no answer" }
            val value = requireNotNull(response.value) { "${item.itemId}: number response has no value" }
            val ok = abs(value - numeric.value) <= numeric.tolerance + 1e-9
            return if (ok) {
                single(Outcome.CORRECT, "answer", PartScore.CORRECT, feedback = fb["correct"])
            } else {
                single(Outcome.WRONG, "answer", PartScore.WRONG, listOf(ErrorTag.CALCULATION), feedback = fb["wrong"])
            }
        }

        if (item.isSequence) {
            require(response.kind == Response.Kind.SEQUENCE) { "${item.itemId}: sequence item needs a sequence response" }
            val ok = response.sequence == item.solution
            return if (ok) {
                single(Outcome.CORRECT, "answer", PartScore.CORRECT, feedback = fb["correct"])
            } else {
                single(Outcome.WRONG, "answer", PartScore.WRONG, listOf(ErrorTag.SEQUENCE), feedback = fb["wrong"])
            }
        }

        if (item.isPairs) {
            require(response.kind == Response.Kind.PAIRS) { "${item.itemId}: pair item needs a pairs response" }
            val given = response.pairs.orEmpty().associate { it.left to it.right }
            val parts = item.solutionPairs.mapValues { (left, right) -> if (given[left] == right) PartScore.CORRECT else PartScore.WRONG }
            val outcome = pickOutcome(parts.values)
            val tags = if (outcome == Outcome.WRONG) listOf(ErrorTag.MISCONCEPTION) else emptyList()
            return ItemScore(outcome, parts, tags, null, listOfNotNull(if (outcome == Outcome.CORRECT) fb["correct"] else fb["wrong"]))
        }

        // Choice family: choose (plain / form / referent), pick_image, true_false, audio_match
        require(response.kind == Response.Kind.CHOICE) { "${item.itemId}: choice item needs a choice response" }
        if (item.type == ItemType.AUDIO_MATCH && response.audioStatus != null && response.audioStatus != AudioStatus.PLAYED) {
            // Audio failed to load: never the learner's fault (spec §5).
            return single(Outcome.NOT_ASSESSED, "answer", PartScore.NOT_ASSESSED)
        }
        val option = item.options.firstOrNull { it.id == response.optionId }
        requireNotNull(option) { "${item.itemId}: unknown option ${response.optionId}" }
        if (option.correct) {
            return single(Outcome.CORRECT, "answer", PartScore.CORRECT, feedback = fb["correct"])
        }
        val tag = option.errorTag ?: if (item.isReferentChoice) ErrorTag.WRONG_REFERENT else null
        val feedback = option.feedbackId ?: fb["wrong"]
        val serious = if (item.isReferentChoice && item.pool != Pool.FOCUS) ErrorTag.WRONG_REFERENT else null
        return single(Outcome.WRONG, "answer", PartScore.WRONG, listOfNotNull(tag), serious, feedback)
    }

    private fun Outcome.key(): String =
        when (this) {
            Outcome.CORRECT -> "correct"
            Outcome.WRONG -> "wrong"
            Outcome.PENDING -> "pending"
            Outcome.DONT_KNOW -> "dont_know"
            Outcome.NOT_ASSESSED -> "not_assessed"
        }

    private fun Outcome.part(): PartScore =
        when (this) {
            Outcome.CORRECT -> PartScore.CORRECT
            Outcome.WRONG -> PartScore.WRONG
            Outcome.PENDING -> PartScore.PENDING
            Outcome.DONT_KNOW -> PartScore.DONT_KNOW
            Outcome.NOT_ASSESSED -> PartScore.NOT_ASSESSED
        }
}
