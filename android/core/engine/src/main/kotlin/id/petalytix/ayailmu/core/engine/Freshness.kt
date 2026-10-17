package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Referent

/**
 * Fresh-item selection and order protection (Trial_App_Spec §6, §7, §9; lessons §3.5), ported from the
 * prototype. "Fresh" = never seen before by this learner. A seen item is never reused as fresh (CR-ENG-3).
 */
@kotlinx.serialization.Serializable
data class AttemptLog(
    val itemId: String,
    val localDate: String,
    val pool: Pool,
    val skills: List<String>,
    val unit: String,
    val firstAttempt: Boolean,
    val hintUsed: Boolean,
) {
    companion object {
        fun of(e: AnswerEvent) = AttemptLog(e.itemId, e.localDate, e.pool, e.skills, e.unit, e.firstAttempt, e.hintUsed)
    }
}

data class FreshContext(
    /** Local calendar date, YYYY-MM-DD. */
    val today: String,
    val history: List<AttemptLog>,
    val rules: RuleConfig,
    /** Profile audience; items without an audience fit everyone. */
    val audience: Audience? = null,
    /** Only items the current build can render (v1 types until P6). */
    val renderable: (Item) -> Boolean = { it.type.isV1 },
) {
    val seen: Set<String> by lazy { history.map { it.itemId }.toSet() }
}

object Freshness {
    private fun lastPracticeDate(
        history: List<AttemptLog>,
        unit: String,
    ): String? =
        history
            .filter { it.unit == unit && it.pool.isPractice }
            .maxOfOrNull { it.localDate }

    fun isEligibleFresh(
        item: Item,
        ctx: FreshContext,
        allItems: List<Item> = emptyList(),
    ): Boolean {
        if (item.pool == Pool.FOCUS) return false
        if (item.itemId in ctx.seen) return false
        if (!ctx.renderable(item)) return false
        if (ctx.audience != null && item.audience != null && item.audience != ctx.audience) return false

        // Forms reserved by a later check must not appear anywhere before that check.
        if (item.forms.isNotEmpty()) {
            val blocked =
                allItems.any { r ->
                    r.reserveForms && r.itemId != item.itemId && r.itemId !in ctx.seen && r.forms.any { it in item.forms }
                }
            if (blocked) return false
        }

        val primary = item.primarySkill
        fun onSkill(h: AttemptLog) = primary != null && primary in h.skills

        if (item.pool == Pool.READY) {
            val practice = ctx.history.count { onSkill(it) && it.pool.isCountedPractice }
            if (practice < ctx.rules.readyAfterPracticeAttempts) return false
        }

        if (item.pool == Pool.D7 || item.pool == Pool.D30) {
            val last = lastPracticeDate(ctx.history, item.unit) ?: return false
            val need = if (item.pool == Pool.D7) ctx.rules.checkDays.d7 else ctx.rules.checkDays.d30
            if (Dates.daysBetween(last, ctx.today) < need) return false
        }

        if (item.laterDay && ctx.history.none { onSkill(it) && it.localDate < ctx.today }) return false

        return true
    }

    fun pickFreshItem(
        items: List<Item>,
        ctx: FreshContext,
        pools: Set<Pool>,
        skill: String? = null,
        exclude: Set<String> = emptySet(),
    ): Item? =
        items
            .withIndex()
            .filter { (_, item) ->
                item.pool in pools &&
                    (skill == null || skill in item.skills) &&
                    item.itemId !in exclude &&
                    isEligibleFresh(item, ctx, items)
            }.sortedWith(compareBy<IndexedValue<Item>>({ it.value.order ?: Int.MAX_VALUE }, { it.index }))
            .firstOrNull()
            ?.value

    /** Focused question after a serious mistake. Not evidence; may be repeated. */
    fun pickFocusItem(
        items: List<Item>,
        tag: ErrorTag,
        referent: Referent? = null,
    ): Item? {
        val focus = items.filter { it.pool == Pool.FOCUS && it.focusFor?.tag == tag }
        return focus.firstOrNull { referent != null && it.focusFor?.referent == referent }
            ?: focus.firstOrNull { it.focusFor?.referent == null }
    }

    data class FormClash(
        val transItem: String,
        val otherItem: String,
        val form: String,
    )

    /** TRANS items must use unseen material: report any form they share with another item (e.g. MT-B3/VT2). */
    fun findFormClashes(items: List<Item>): List<FormClash> {
        val clashes = mutableListOf<FormClash>()
        for (t in items.filter { it.pool == Pool.TRANS }) {
            for (o in items) {
                if (o === t || o.pool == Pool.FOCUS) continue
                for (form in t.forms) if (form in o.forms) clashes += FormClash(t.itemId, o.itemId, form)
            }
        }
        return clashes
    }
}
