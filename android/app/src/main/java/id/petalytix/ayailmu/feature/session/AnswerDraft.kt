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
import id.petalytix.ayailmu.feature.session.interact.PairBoard
import id.petalytix.ayailmu.feature.session.interact.PairPick
import id.petalytix.ayailmu.feature.session.interact.SlotBoard
import id.petalytix.ayailmu.feature.session.story.StoryTimeline

/**
 * What the learner has entered for the current question, before "Check". Lives as long as the step is on
 * screen (keyed by position), so a failed save keeps the answer and the learner just taps Check again.
 * [toResponse] is the single place where UI input becomes an engine [Response]; null = not complete yet.
 * The pairing and slot rules live in the pure PairBoard and SlotBoard (shared by tap, drag and connect).
 */
class AnswerDraft {
    var choice by mutableStateOf<String?>(null)
    var text by mutableStateOf("")

    /** Paraphrase "who": [Response.refTag] value or [Response.REF_DONT_KNOW]. */
    var ref by mutableStateOf<String?>(null)
    val placed = mutableStateListOf<String>()

    /** PAIRS / BUCKETS / MEMORY: left id to right id (a right id may repeat for baskets). */
    val pairs = mutableStateMapOf<String, String>()

    /** Tap-then-tap: the card picked up, if any (either column on one-to-one boards, only cards for baskets). */
    var pick by mutableStateOf<PairPick?>(null)

    /** The picked left card, if the pick is a left card. */
    val activeLeft: String? get() = pick?.takeIf { it.left }?.id

    /** audio_match: the clip is not on this phone (set by the listen renderer), so the answer says "audio unavailable". */
    var voiceMissing by mutableStateOf(false)

    /** TRACE: the strokes finished so far ("1", "2", ...), in the order they were traced. */
    val traced = mutableStateListOf<String>()

    /** TRACE: how many strokes the glyph has; 0 = no stroke data on this phone (set by the trace renderer). */
    var traceStrokes by mutableStateOf(0)

    /** TRACE without stroke data: the learner looked at the letter and chose "Lanjut" (sent as "don't know"). */
    var traceSkipped by mutableStateOf(false)

    /** SLIDER: null until the learner has moved the slider, so "Check" never sends an untouched default. */
    var sliderValue by mutableStateOf<Double?>(null)

    /** MEMORY: cards face up right now (at most two). Found pairs go into [pairs] (left id to right id). */
    val faceUp = mutableStateListOf<String>()

    /** MEMORY: pairs turned over that did not match. Shown nowhere as a score; only for the gentle summary line. */
    var misses by mutableStateOf(0)

    /** STORY: the panel on screen and the furthest one reached; null until the learner turns the first page. */
    var story by mutableStateOf<StoryTimeline?>(null)

    /** STORY: where the learner is in [q]'s story (the first panel until they move on). */
    fun storyTimeline(q: StepUi.Question): StoryTimeline = story ?: StoryTimeline.start(q.story?.panels?.size ?: 0)

    fun isFound(card: MemoryCardUi): Boolean = pairs.containsKey(card.pairKey)

    /**
     * Turns a card over. A matching pair stays face up for good; two cards that do not match stay visible until
     * the next tap (no timer, so it works with animations off and with a screen reader).
     */
    fun flip(
        card: MemoryCardUi,
        cards: List<MemoryCardUi>,
    ) {
        if (isFound(card) || card.cardId in faceUp) return
        if (faceUp.size == 2) faceUp.clear()
        faceUp.add(card.cardId)
        if (faceUp.size < 2) return
        val a = cards.firstOrNull { it.cardId == faceUp[0] } ?: return
        val b = cards.firstOrNull { it.cardId == faceUp[1] } ?: return
        if (a.pairKey == b.pairKey && a.left != b.left) {
            val l = if (a.left) a else b
            val r = if (a.left) b else a
            pairs[l.option.id] = r.option.id
            faceUp.clear()
        } else {
            misses++
        }
    }

    /** Tap on a tile: into the next empty place, or back to the pool if it is already placed. */
    fun place(
        id: String,
        slots: Int,
    ) {
        SlotBoard.tap(placed, id, slots)
    }

    /** Drag a tile onto place [slot] (0-based): put in, or moved there when it was already placed. */
    fun dropInSlot(
        id: String,
        slot: Int,
        slots: Int,
    ): Boolean = SlotBoard.drop(placed, id, slot, slots)

    /** Drag a placed tile back to the pool. */
    fun takeBack(id: String): Boolean = SlotBoard.takeBack(placed, id)

    /** Tap-then-tap on a pairs board; returns what happened so the renderer can play the matching sound. */
    fun tapCard(
        id: String,
        left: Boolean,
        oneToOne: Boolean,
    ): PairBoard.Event {
        val r = PairBoard.tap(pairs, pick, PairPick(id, left), oneToOne)
        pick = r.pick
        return r.event
    }

    /** Tap on the left column: pick it up (taking it off its partner if it had one), or put it down again. */
    fun tapLeft(id: String) {
        tapCard(id, left = true, oneToOne = true)
    }

    /** Tap on the right column: pair it with the picked card. One-to-one for match_pairs, many-to-one for buckets. */
    fun tapRight(
        id: String,
        oneToOne: Boolean,
    ) {
        tapCard(id, left = false, oneToOne = oneToOne)
    }

    /** Drag or connect: link [left] to [right] directly (clears any tap pick). */
    fun link(
        left: String,
        right: String,
        oneToOne: Boolean,
    ): Boolean {
        pick = null
        return PairBoard.link(pairs, left, right, oneToOne)
    }

    /** Take a card off its partner, target or basket. */
    fun unlink(left: String): Boolean {
        if (pick?.id == left) pick = null
        return PairBoard.unlink(pairs, left)
    }

    /** TRACE: stroke [index] (0-based) was traced well enough. */
    fun strokeDone(index: Int) {
        val id = (index + 1).toString()
        if (id !in traced) traced.add(id)
    }

    /** TRACE: every stroke is done (false while the glyph has no stroke data). */
    val traceComplete: Boolean get() = traceStrokes > 0 && traced.size >= traceStrokes

    fun toResponse(q: StepUi.Question): Response? =
        when (q.kind) {
            RenderKind.GEM, RenderKind.INFO -> Response.choice(SEEN)
            // Watched to its last panel (or skipped): "seen", like an info card. Never scored, never evidence.
            RenderKind.STORY -> if (storyTimeline(q).finished) Response.choice(SEEN) else null
            RenderKind.CHOICE ->
                choice?.let { id ->
                    when {
                        q.audioMissing || (q.listen && voiceMissing) ->
                            Response(kind = Response.Kind.CHOICE, optionId = id, audioStatus = AudioStatus.UNAVAILABLE)
                        q.listen -> Response(kind = Response.Kind.CHOICE, optionId = id, audioStatus = AudioStatus.PLAYED)
                        else -> Response.choice(id)
                    }
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
            RenderKind.HOTSPOT -> choice?.let { Response.choice(it) }
            RenderKind.NUMBER -> parseNumber(text, q.lang)?.let { Response.number(it) }
            RenderKind.SLIDER -> sliderValue?.let { Response.number(it) }
            RenderKind.SEQUENCE -> if (q.slots > 0 && placed.size == q.slots) Response.sequence(placed.toList()) else null
            RenderKind.PAIRS, RenderKind.BUCKETS, RenderKind.MEMORY ->
                PairBoard.pairings(pairs, q.left.map { it.id })?.let { Response.pairs(it) }
            // Practice only: the ids of the strokes traced; no stroke data on the phone = "don't know" after "Lanjut".
            RenderKind.TRACE ->
                when {
                    traceComplete -> Response.sequence(traced.toList())
                    traceSkipped -> Response.dontKnow()
                    else -> null
                }
            RenderKind.UNSUPPORTED -> null
        }

    companion object {
        /** Option id recorded for gem and info cards and stories, which are seen, not answered (scored not_assessed). */
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
