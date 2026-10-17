package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool

/**
 * Spaced review (Trial_App_Spec §6–7, framework §3): a seen item climbs the spacing ladder 1 → 3 → 7 (→ 21)
 * days on each correct review and steps back one rung on a mistake. Review answers are practice, never
 * evidence. New in the Kotlin engine — the prototype left review scheduling for "broader pilot work".
 */
object ReviewScheduler {
    data class DueReview(
        val itemId: String,
        val rung: Int,
        val overdueDays: Long,
    )

    private val NEVER_REVIEWED = setOf(Pool.FOCUS, Pool.GEM, Pool.INSTR)

    fun due(
        items: List<Item>,
        history: List<AnswerEvent>,
        today: String,
        rules: RuleConfig,
    ): List<DueReview> {
        val byItem = items.associateBy { it.itemId }
        val ladder = rules.reviewSpacingDays
        val out = mutableListOf<DueReview>()
        history
            .groupBy { it.itemId }
            .forEach { (itemId, events) ->
                val item = byItem[itemId] ?: return@forEach
                if (item.pool in NEVER_REVIEWED || !item.type.evidenceCapable) return@forEach
                val ordered = events.sortedWith(compareBy({ it.localDate }, { it.timestamp }))
                var rung = 0
                ordered.drop(1).forEach { e ->
                    rung =
                        when (e.outcome) {
                            Outcome.CORRECT -> minOf(rung + 1, ladder.lastIndex)
                            Outcome.WRONG, Outcome.DONT_KNOW -> maxOf(rung - 1, 0)
                            else -> rung
                        }
                }
                val last = ordered.last()
                if (last.localDate >= today) return@forEach // already touched today
                val waited = Dates.daysBetween(last.localDate, today)
                val need = ladder[rung]
                if (waited >= need) out += DueReview(itemId, rung, waited - need)
            }
        return out.sortedWith(compareByDescending<DueReview> { it.overdueDays }.thenBy { it.itemId })
    }

    /** How many review slots a session may spend (framework §3 / §4: ≤ review_share_max of the plan). */
    fun cap(
        plannedItems: Int,
        rules: RuleConfig,
    ): Int = kotlin.math.floor(plannedItems * rules.reviewShareMax).toInt()

    fun isReviewable(item: Item): Boolean = item.pool !in NEVER_REVIEWED && item.type != ItemType.INFO_CARD
}
