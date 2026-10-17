package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.AudioStatus
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Referent
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** UI input → engine Response, the single conversion point; null means "Check" stays disabled. */
class AnswerDraftTest {
    private fun q(
        kind: RenderKind,
        slots: Int = 0,
        left: List<String> = emptyList(),
        audioMissing: Boolean = false,
    ) = StepUi.Question(
        itemId = "X",
        kind = kind,
        role = Step.Role.PRACTICE,
        prompt = "",
        target = null,
        help = emptyList(),
        left = left.map { OptionUi(it, it, null, null) },
        slots = slots,
        audioMissing = audioMissing,
    )

    @Test
    fun `numbers are read the way each instruction language writes them`() {
        assertEquals(58.0, AnswerDraft.parseNumber("58")!!, 0.0)
        assertEquals(2.5, AnswerDraft.parseNumber("2,5")!!, 0.0)
        assertEquals(2.5, AnswerDraft.parseNumber("2.5")!!, 0.0)
        assertEquals(1000.0, AnswerDraft.parseNumber("1.000")!!, 0.0)
        assertEquals(1234.5, AnswerDraft.parseNumber("1.234,5")!!, 0.0)
        assertNull(AnswerDraft.parseNumber(""))
        assertNull(AnswerDraft.parseNumber("-"))
        assertEquals(1000.0, AnswerDraft.parseNumber("1,000", Lang.EN)!!, 0.0)
        assertEquals(2.5, AnswerDraft.parseNumber("2.5", Lang.EN)!!, 0.0)
    }

    @Test
    fun `choice needs a pick, and audio without a clip is marked unavailable`() {
        val d = AnswerDraft()
        assertNull(d.toResponse(q(RenderKind.CHOICE)))
        d.choice = "b"
        assertEquals(Response.choice("b"), d.toResponse(q(RenderKind.CHOICE)))
        assertEquals(AudioStatus.UNAVAILABLE, d.toResponse(q(RenderKind.CHOICE, audioMissing = true))!!.audioStatus)
    }

    @Test
    fun `paraphrase needs text and a who answer`() {
        val d = AnswerDraft()
        d.text = "  dia orang yang beriman "
        assertNull(d.toResponse(q(RenderKind.PARAPHRASE)))
        d.ref = Response.refTag(Referent.PEREMPUAN)
        assertEquals(Response.typed("dia orang yang beriman", Referent.PEREMPUAN), d.toResponse(q(RenderKind.PARAPHRASE)))
        d.ref = Response.REF_DONT_KNOW
        assertEquals(Response.typedRefUnknown("dia orang yang beriman"), d.toResponse(q(RenderKind.PARAPHRASE)))
    }

    @Test
    fun `sequence is complete only when every slot is filled, and a tap takes a tile back`() {
        val d = AnswerDraft()
        val seq = q(RenderKind.SEQUENCE, slots = 2)
        d.place("a", 2)
        assertNull(d.toResponse(seq))
        d.place("b", 2)
        d.place("c", 2) // full: ignored
        assertEquals(Response.sequence(listOf("a", "b")), d.toResponse(seq))
        d.place("a", 2) // take back
        assertEquals(listOf("b"), d.placed.toList())
    }

    @Test
    fun `match pairs are one-to-one, buckets are many-to-one`() {
        val pairs = q(RenderKind.PAIRS, left = listOf("n1", "n2"))
        val d = AnswerDraft()
        d.tapLeft("n1")
        d.tapRight("w1", oneToOne = true)
        d.tapLeft("n2")
        d.tapRight("w1", oneToOne = true) // steals w1 from n1
        assertEquals(mapOf("n2" to "w1"), d.pairs.toMap())
        assertNull(d.toResponse(pairs))

        val buckets = q(RenderKind.BUCKETS, left = listOf("n1", "n2"))
        val b = AnswerDraft()
        b.tapLeft("n1")
        b.tapRight("even", oneToOne = false)
        b.tapLeft("n2")
        b.tapRight("even", oneToOne = false)
        assertEquals(
            Response.pairs(listOf(Response.Pairing("n1", "even"), Response.Pairing("n2", "even"))),
            b.toResponse(buckets),
        )
    }

    @Test
    fun `gem and info cards are recorded as seen`() {
        assertEquals(Response.choice(AnswerDraft.SEEN), AnswerDraft().toResponse(q(RenderKind.GEM)))
    }
}
