package id.petalytix.ayailmu.feature.progress

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.SkillProjector
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.TrackMode

/** "x of y"; never turned into a percentage on evidence tracks (CR-HAB-4). */
data class Count(
    val done: Int,
    val of: Int,
)

/**
 * What the progress screen shows for one track. Evidence tracks: three honest lines — learned, still
 * remembered after 7–30 days, understands new sentences (CR-HAB-4). Casual tracks: one mastery bar.
 * Everything is recomputed from answer events (CR-ENG-11); nothing here is stored.
 */
data class ProgressSummary(
    val mode: TrackMode,
    /** Skills marked learned by SkillProjector, of all skills the track teaches. */
    val learned: Count,
    /** Correct later checks (D7/D30 items), of later checks answered. */
    val remembered: Count,
    /** Correct transfer items (TRANS: sentences never seen before), of those answered. */
    val newSentences: Count,
    val words: Count,
    val practicing: Int,
    /** Skills held back by an unresolved serious mistake (shown calmly as "needs a follow-up"). */
    val needsFollowUp: Int,
    /** Typed answers waiting for a human check (exported and checked in a spreadsheet). */
    val waitingForCheck: Int,
    val gems: Int,
    val daysPracticed: Int,
) {
    val hasAnyActivity: Boolean get() = daysPracticed > 0
}

object ProgressCalculator {
    private val NOT_TAUGHT = setOf(Pool.FOCUS, Pool.GEM)
    private val ANSWERED = setOf(Outcome.CORRECT, Outcome.WRONG, Outcome.DONT_KNOW, Outcome.PENDING)

    fun compute(
        history: List<AnswerEvent>,
        rules: RuleConfig,
        content: GatedContent,
    ): ProgressSummary {
        val taught = content.items.filter { it.pool !in NOT_TAUGHT }.flatMap { it.skills }.toSet()
        val projection = SkillProjector.project(history, rules, content)
        val states = projection.skills.filterKeys { it in taught }.values
        val words = content.items.mapNotNull { it.wordId }.toSet()

        fun countPools(pools: Set<Pool>): Count {
            val answered = history.filter { it.pool in pools && it.outcome in ANSWERED }
            return Count(done = answered.count { it.outcome == Outcome.CORRECT }, of = answered.size)
        }

        // A typed answer stays "waiting" only while it is the latest answer to that item.
        val latestPerItem = history.groupBy { it.itemId }.mapValues { (_, e) -> e.maxByOrNull { it.timestamp } }
        return ProgressSummary(
            mode = rules.mode,
            learned = Count(states.count { it.status == SkillProjector.Status.LEARNED }, taught.size),
            remembered = countPools(setOf(Pool.D7, Pool.D30)),
            newSentences = countPools(setOf(Pool.TRANS)),
            words = Count(projection.words.filterKeys { it in words }.values.count { it.learned }, words.size),
            practicing =
                states.count {
                    it.status == SkillProjector.Status.PRACTICING || it.status == SkillProjector.Status.OUT_OF_FRESH
                },
            needsFollowUp = states.count { it.status == SkillProjector.Status.BLOCKED },
            waitingForCheck = latestPerItem.values.count { it?.outcome == Outcome.PENDING },
            gems = history.filter { it.gem }.map { it.itemId }.distinct().size,
            daysPracticed = history.map { it.localDate }.distinct().size,
        )
    }
}
