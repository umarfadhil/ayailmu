package id.petalytix.ayailmu.feature.session.interact

import id.petalytix.ayailmu.core.content.Gestures
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepUi

/**
 * Sequence answers (order, tiles, fill_blank): the tiles placed so far, in place order, with no gaps. Place
 * numbers beyond the filled ones mean "at the end". Pure Kotlin over the draft's list, shared by the tap renderer
 * and the drag renderer, so both behave the same.
 */
object SlotBoard {
    /** Tap: a placed tile goes back to the pool; a free tile goes into the next empty place (ignored when full). */
    fun tap(
        placed: MutableList<String>,
        id: String,
        slots: Int,
    ): Boolean =
        when {
            id in placed -> placed.remove(id)
            placed.size < slots -> placed.add(id)
            else -> false
        }

    /**
     * Drop [id] on place [slot] (0-based). A placed tile moves there (reorder). A free tile is put in there, the
     * later tiles moving one place on; when every place is already filled it swaps out the tile in that place,
     * which goes back to the pool. False = nothing changed.
     */
    fun drop(
        placed: MutableList<String>,
        id: String,
        slot: Int,
        slots: Int,
    ): Boolean {
        if (slots <= 0) return false
        val target = slot.coerceIn(0, slots - 1)
        val from = placed.indexOf(id)
        if (from >= 0) {
            val to = target.coerceAtMost(placed.size - 1)
            if (to == from) return false
            placed.removeAt(from)
            placed.add(to, id)
            return true
        }
        if (placed.size < slots) {
            placed.add(target.coerceAtMost(placed.size), id)
            return true
        }
        placed[target] = id
        return true
    }

    /** Drag a placed tile back to the pool. */
    fun takeBack(
        placed: MutableList<String>,
        id: String,
    ): Boolean = placed.remove(id)

    /**
     * fill_blank: the sentence split at its gaps. A gap is a run of two or more underscores ("Kita berpikir dengan
     * ____." gives ["Kita berpikir dengan ", "."]) or of full-width low lines as Japanese and Chinese text writes it
     * ("＿＿が すき！"). One part = no gap. No regex (CR-KT-9).
     */
    fun splitBlanks(text: String): List<String> {
        val parts = mutableListOf<String>()
        val current = StringBuilder()
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == WIDE_LOW_LINE || (c == '_' && i + 1 < text.length && text[i + 1] == '_')) {
                parts += current.toString()
                current.clear()
                while (i < text.length && text[i] == c) i++
                continue
            }
            current.append(text[i])
            i++
        }
        parts += current.toString()
        return parts
    }

    /** True when [text] has at least one gap. */
    fun hasBlank(text: String?): Boolean = text != null && splitBlanks(text).size > 1

    /** The parts of a fill_blank sentence when it has exactly one gap per place, else null (numbered places instead). */
    fun inlineBlank(
        text: String?,
        slots: Int,
    ): List<String>? {
        if (text == null || slots <= 0) return null
        return splitBlanks(text).takeIf { it.size == slots + 1 }
    }

    /**
     * The sentence the drag renderer draws with its places inside the gaps (the target text, or the help line that
     * holds the gap), split at the gaps; null when the question uses numbered places instead.
     */
    fun inlineParts(q: StepUi.Question): List<String>? {
        if (q.kind != RenderKind.SEQUENCE || q.gesture != Gestures.DRAG) return null
        val text = if (q.blankInTarget) q.target else q.blankLine?.let { q.help.getOrNull(it)?.meaning }
        return inlineBlank(text, q.slots)
    }

    /** U+FF3F, the full-width low line used for gaps in Japanese and Chinese text. */
    private const val WIDE_LOW_LINE = '\uFF3F'
}
