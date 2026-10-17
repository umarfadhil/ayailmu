package id.petalytix.ayailmu.feature.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import id.petalytix.ayailmu.core.model.AudioStatus
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response

/**
 * What the learner has entered for the current question, before "Check". Lives as long as the step is on
 * screen (keyed by position), so a failed save keeps the answer and the learner just taps Check again.
 * [toResponse] is the single place where UI input becomes an engine [Response]; null = not complete yet.
 */
class AnswerDraft {
    var choice by mutableStateOf<String?>(null)
    var text by mutableStateOf("")

    /** Paraphrase "who": [Response.refTag] value or [Response.REF_DONT_KNOW]. */
    var ref by mutableStateOf<String?>(null)
    val placed = mutableStateListOf<String>()
    val pairs = mutableStateMapOf<String, String>()
    var activeLeft by mutableStateOf<String?>(null)

    fun place(
        id: String,
        slots: Int,
    ) {
        if (id in placed) placed.remove(id) else if (placed.size < slots) placed.add(id)
    }

    /** Tap on the left column: select it (or un-pair it if it was already paired). */
    fun tapLeft(id: String) {
        if (pairs.remove(id) != null) {
            activeLeft = id
            return
        }
        activeLeft = if (activeLeft == id) null else id
    }

    /** Tap on the right column: pair it with the selected left item. One-to-one for match_pairs, many-to-one for buckets. */
    fun tapRight(
        id: String,
        oneToOne: Boolean,
    ) {
        val left = activeLeft ?: return
        if (oneToOne) pairs.entries.firstOrNull { it.value == id }?.let { pairs.remove(it.key) }
        pairs[left] = id
        activeLeft = null
    }

    fun toResponse(q: StepUi.Question): Response? =
        when (q.kind) {
            RenderKind.GEM, RenderKind.INFO -> Response.choice(SEEN)
            RenderKind.CHOICE ->
                choice?.let { id ->
                    if (q.audioMissing) Response(kind = Response.Kind.CHOICE, optionId = id, audioStatus = AudioStatus.UNAVAILABLE) else Response.choice(id)
                }
            RenderKind.TYPED -> text.trim().takeIf { it.isNotEmpty() }?.let { Response.typed(it) }
            RenderKind.PARAPHRASE -> {
                val t = text.trim()
                val r = ref
                when {
                    t.isEmpty() || r == null -> null
                    r == Response.REF_DONT_KNOW -> Response.typedRefUnknown(t)
                    else -> Response.typed(t, if (r == Response.refTag(Referent.PEREMPUAN)) Referent.PEREMPUAN else Referent.LAKI_LAKI)
                }
            }
            RenderKind.NUMBER -> parseNumber(text, q.lang)?.let { Response.number(it) }
            RenderKind.SEQUENCE -> if (q.slots > 0 && placed.size == q.slots) Response.sequence(placed.toList()) else null
            RenderKind.PAIRS, RenderKind.BUCKETS ->
                if (q.left.isNotEmpty() && q.left.all { it.id in pairs }) {
                    Response.pairs(q.left.map { Response.Pairing(it.id, pairs.getValue(it.id)) })
                } else {
                    null
                }
            RenderKind.UNSUPPORTED -> null
        }

    companion object {
        /** Option id recorded for gem and info cards, which are seen, not answered (scored not_assessed). */
        const val SEEN = "seen"

        private val ID_THOUSANDS = Regex("^-?\\d{1,3}(\\.\\d{3})+$")

        /**
         * Reads a typed number the way the instruction language writes it. Indonesian: comma = decimal mark,
         * dots grouped in threes = thousands ("2,5", "1.000"); a lone "2.5" is still read as 2.5. English: dot =
         * decimal mark, commas = thousands ("2.5", "1,000").
         */
        fun parseNumber(
            raw: String,
            lang: Lang = Lang.ID,
        ): Double? {
            val t = raw.trim().replace(" ", "")
            if (t.isEmpty()) return null
            val normalized =
                when {
                    lang == Lang.EN -> t.replace(",", "")
                    ',' in t -> t.replace(".", "").replace(',', '.')
                    ID_THOUSANDS.matches(t) -> t.replace(".", "")
                    else -> t
                }
            return normalized.toDoubleOrNull()
        }
    }
}
