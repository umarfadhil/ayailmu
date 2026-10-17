package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.TrackMode

/**
 * Projects skill states from answer events + a RuleConfig (CR-ARC-4; Trial_App_Spec §7; framework §3).
 * Pure and recomputable: change the rules, re-run, and every state follows. The prototype left this to
 * "broader pilot work"; it is new in the Kotlin engine and therefore the first place to look when a number
 * on the progress screen looks wrong.
 */
object SkillProjector {
    enum class Status { NOT_STARTED, PRACTICING, LEARNED, BLOCKED, OUT_OF_FRESH }

    data class SkillState(
        val skill: String,
        val status: Status,
        val freshAttempts: Int,
        val correctInWindow: Int,
        val windowSize: Int,
        val distinctItems: Int,
        val typedOrBuilt: Int,
        val readyCount: Int,
        val laterDay: Boolean,
        val blockedBy: ErrorTag? = null,
        val lastDate: String? = null,
        val rulesVersion: String,
    )

    data class WordState(
        val wordId: String,
        val learned: Boolean,
        val correctDays: Int,
    )

    data class Projection(
        val skills: Map<String, SkillState>,
        val words: Map<String, WordState>,
    )

    private fun isTypedOrBuilt(
        type: ItemType,
        rules: RuleConfig,
    ): Boolean =
        when (type) {
            ItemType.TYPE_IN, ItemType.NUMBER_INPUT -> true
            ItemType.TILES, ItemType.FILL_BLANK, ItemType.ORDER -> rules.tileCountsAsFree
            else -> false
        }

    private fun isBinary(
        e: AnswerEvent,
        content: GatedContent?,
    ): Boolean {
        if (e.itemType == ItemType.TRUE_FALSE) return true
        val item = content?.itemOrNull(e.itemId) ?: return false
        return item.isChoiceFamily && item.options.size == 2
    }

    fun project(
        history: List<AnswerEvent>,
        rules: RuleConfig,
        content: GatedContent? = null,
        flags: Collection<String> = emptyList(),
    ): Projection {
        val ordered = history.sortedWith(compareBy({ it.localDate }, { it.timestamp }))
        val blocked = Session.unresolvedSerious(ordered).associate { it.skill to it.tag }
        val outOfFresh = flags.filter { it.startsWith("out-of-fresh:") }.map { it.removePrefix("out-of-fresh:") }.toSet()
        val learnedRule = rules.learned

        val bySkill = LinkedHashMap<String, MutableList<AnswerEvent>>()
        for (e in ordered) for (s in e.skills) bySkill.getOrPut(s) { mutableListOf() } += e

        val skills =
            bySkill.mapValues { (skill, events) ->
                // Evidence attempts: fresh evidence only (first attempt, no hint, evidence-capable pool/type).
                // Casual mode is lighter: any non-hinted attempt on an evidence-capable item counts.
                val counted =
                    events.filter { e ->
                        e.outcome == Outcome.CORRECT || e.outcome == Outcome.WRONG || e.outcome == Outcome.DONT_KNOW
                    }.filter { e ->
                        if (rules.mode == TrackMode.EVIDENCE) e.freshEvidence else !e.hintUsed && e.itemType.evidenceCapable && e.pool != Pool.FOCUS
                    }
                // Binary (2-option) items count only once their streak condition holds (spec §7).
                val binary = counted.filter { isBinary(it, content) }
                val binaryOk =
                    binary.isEmpty() || run {
                        val tail = binary.takeLast(rules.binaryStreak)
                        tail.size == rules.binaryStreak &&
                            tail.all { it.outcome == Outcome.CORRECT } &&
                            tail.map { it.localDate }.distinct().size >= rules.binaryMinDays
                    }
                val effective = if (binaryOk) counted else counted.filter { !isBinary(it, content) }
                val window = effective.takeLast(learnedRule.window)
                val correct = window.count { it.outcome == Outcome.CORRECT }
                val correctEvents = window.filter { it.outcome == Outcome.CORRECT }
                val typedOrBuilt = correctEvents.count { isTypedOrBuilt(it.itemType, rules) }
                val distinct = correctEvents.map { it.itemId }.distinct().size
                val ready = correctEvents.count { it.pool == Pool.READY }
                val firstDay = effective.firstOrNull()?.localDate
                val laterDay = firstDay != null && window.any { it.localDate > firstDay }

                val meets =
                    window.size >= learnedRule.minCorrect &&
                        correct >= learnedRule.minCorrect &&
                        typedOrBuilt >= learnedRule.minTypedOrBuilt &&
                        distinct >= learnedRule.minDistinctItems &&
                        ready >= learnedRule.minReady &&
                        (!learnedRule.requireLaterDay || laterDay)
                val status =
                    when {
                        skill in blocked -> Status.BLOCKED
                        meets -> Status.LEARNED
                        skill in outOfFresh -> Status.OUT_OF_FRESH
                        events.isEmpty() -> Status.NOT_STARTED
                        else -> Status.PRACTICING
                    }
                SkillState(
                    skill = skill,
                    status = status,
                    freshAttempts = effective.size,
                    correctInWindow = correct,
                    windowSize = learnedRule.window,
                    distinctItems = distinct,
                    typedOrBuilt = typedOrBuilt,
                    readyCount = ready,
                    laterDay = laterDay,
                    blockedBy = blocked[skill],
                    lastDate = events.lastOrNull()?.localDate,
                    rulesVersion = rules.rulesVersion,
                )
            }

        // Word learned = correct typed meaning on N different days (spec §7).
        val words: Map<String, WordState> =
            if (content == null) {
                emptyMap()
            } else {
                ordered
                    .filter { it.outcome == Outcome.CORRECT && it.itemType == ItemType.TYPE_IN }
                    .mapNotNull { e -> content.itemOrNull(e.itemId)?.wordId?.let { it to e.localDate } }
                    .groupBy({ it.first }, { it.second })
                    .mapValues { (wordId, days) ->
                        val n = days.distinct().size
                        WordState(wordId, learned = n >= rules.wordLearnedDays, correctDays = n)
                    }
            }

        return Projection(skills, words)
    }
}
