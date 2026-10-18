package id.petalytix.ayailmu.feature.session.interact

import id.petalytix.ayailmu.core.model.Response

/** A card picked up in tap-then-tap mode. [left] = the card that gets placed (left column or pool), else its target. */
data class PairPick(
    val id: String,
    val left: Boolean,
)

/**
 * Pairing rules shared by every pairs renderer: connect lines, drag onto a target, baskets and tap-then-tap
 * (docs/content/INTERACTIONS_AUDIO.md section 2.1). Pure Kotlin over the draft's link map (left id to right id),
 * so Compose observes the very map these functions edit. One-to-one boards (match_pairs) give a right card at
 * most one partner; baskets (sort_buckets) take any number of cards. The engine Response is still built only in
 * AnswerDraft.toResponse (CR-ENG-12), from [pairings].
 */
object PairBoard {
    /** What a tap did, so the renderer can play the matching sound (INTERACTIONS_AUDIO.md section 3.2). */
    enum class Event { PICKED, SWITCHED, UNPICKED, LINKED, UNLINKED, NONE }

    data class Tap(
        val pick: PairPick?,
        val event: Event,
    )

    /** Links [left] to [right]. A one-to-one board first frees [right] from any other partner. False = no change. */
    fun link(
        links: MutableMap<String, String>,
        left: String,
        right: String,
        oneToOne: Boolean,
    ): Boolean {
        if (links[left] == right) return false
        if (oneToOne) {
            links.entries
                .filter { it.value == right && it.key != left }
                .map { it.key }
                .forEach { links.remove(it) }
        }
        links[left] = right
        return true
    }

    fun unlink(
        links: MutableMap<String, String>,
        left: String,
    ): Boolean = links.remove(left) != null

    /** The left card linked to [right] (one-to-one boards; for a basket, the first card in it). */
    fun partnerOf(
        links: Map<String, String>,
        right: String,
    ): String? = links.entries.firstOrNull { it.value == right }?.key

    /** Cards in a basket (or the one card on a one-to-one target), in the order of [lefts]. */
    fun inTarget(
        links: Map<String, String>,
        right: String,
        lefts: List<String>,
    ): List<String> = lefts.filter { links[it] == right }

    /**
     * Tap-then-tap. Tapping the picked card again puts it down. Tapping a card on the same side as the pick (or
     * with nothing picked) picks it; a linked card comes off its partner first ("tapping a connected card removes
     * the link") and stays picked, ready to go somewhere else. Tapping the other side links the two. Baskets are
     * never picked: a basket tapped with nothing picked does nothing.
     */
    fun tap(
        links: MutableMap<String, String>,
        pick: PairPick?,
        tapped: PairPick,
        oneToOne: Boolean,
    ): Tap {
        if (pick == tapped) return Tap(null, Event.UNPICKED)
        if (pick == null || pick.left == tapped.left) {
            if (tapped.left) {
                val was = links.remove(tapped.id) != null
                val event =
                    when {
                        was -> Event.UNLINKED
                        pick == null -> Event.PICKED
                        else -> Event.SWITCHED
                    }
                return Tap(tapped, event)
            }
            if (!oneToOne) return Tap(pick, Event.NONE)
            val partner = partnerOf(links, tapped.id)
            if (partner != null) {
                links.remove(partner)
                return Tap(tapped, Event.UNLINKED)
            }
            return Tap(tapped, if (pick == null) Event.PICKED else Event.SWITCHED)
        }
        val left = if (pick.left) pick.id else tapped.id
        val right = if (pick.left) tapped.id else pick.id
        link(links, left, right, oneToOne)
        return Tap(null, Event.LINKED)
    }

    fun isComplete(
        links: Map<String, String>,
        lefts: List<String>,
    ): Boolean = lefts.isNotEmpty() && lefts.all { it in links }

    /** Every left card with its partner, in [lefts] order; null until every left card is placed. */
    fun pairings(
        links: Map<String, String>,
        lefts: List<String>,
    ): List<Response.Pairing>? = if (isComplete(links, lefts)) lefts.map { Response.Pairing(it, links.getValue(it)) } else null
}
