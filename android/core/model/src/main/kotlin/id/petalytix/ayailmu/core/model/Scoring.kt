package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Per-part auto score (Trial_App_Spec §5, §10). */
@Serializable
enum class PartScore {
    @SerialName("correct")
    CORRECT,

    @SerialName("wrong")
    WRONG,

    @SerialName("pending")
    PENDING,

    @SerialName("dont_know")
    DONT_KNOW,

    @SerialName("not_assessed")
    NOT_ASSESSED,
}

/** Whole-item outcome. `pending` = waiting for human check; counts neither right nor wrong. */
@Serializable
enum class Outcome {
    @SerialName("correct")
    CORRECT,

    @SerialName("wrong")
    WRONG,

    @SerialName("pending")
    PENDING,

    @SerialName("dont_know")
    DONT_KNOW,

    @SerialName("not_assessed")
    NOT_ASSESSED,
}

/** Error tags from the lessons file plus generic ones for casual tracks. */
@Serializable
enum class ErrorTag {
    @SerialName("wrong-referent")
    WRONG_REFERENT,

    @SerialName("possession")
    POSSESSION,

    @SerialName("invented-action")
    INVENTED_ACTION,

    @SerialName("wrong-form")
    WRONG_FORM,

    @SerialName("lexical")
    LEXICAL,

    @SerialName("look-alike")
    LOOK_ALIKE,

    @SerialName("decoding")
    DECODING,

    @SerialName("ta-confusion")
    TA_CONFUSION,

    @SerialName("wrong-speaker")
    WRONG_SPEAKER,

    @SerialName("calculation")
    CALCULATION,

    @SerialName("misconception")
    MISCONCEPTION,

    @SerialName("sequence")
    SEQUENCE,
}

/** Who a sentence is about (Arabic track). Indonesian "dia" hides gender, so this is a separate part. */
@Serializable
enum class Referent {
    @SerialName("laki-laki")
    LAKI_LAKI,

    @SerialName("perempuan")
    PEREMPUAN,
}

/** Review gate for every learner-facing content object (CR-ENG-2). */
@Serializable
enum class ReviewStatus {
    @SerialName("draft")
    DRAFT,

    @SerialName("reviewed_subject")
    REVIEWED_SUBJECT,

    @SerialName("reviewed_language")
    REVIEWED_LANGUAGE,

    @SerialName("approved")
    APPROVED,
}

/** How the clip behaved for an audio item; a failure is never the learner's fault (`not_assessed`). */
@Serializable
enum class AudioStatus {
    @SerialName("played")
    PLAYED,

    @SerialName("failed")
    FAILED,

    @SerialName("unavailable")
    UNAVAILABLE,
}

/**
 * What the learner did. One flat shape (not a sealed hierarchy) so the raw response serialises to stable JSON
 * and can be stored verbatim as `raw_response` (Trial_App_Spec §10). Unused fields are omitted from JSON.
 */
@Serializable
data class Response(
    val kind: Kind,
    val text: String? = null,
    val ref: String? = null,
    @SerialName("option_id") val optionId: String? = null,
    val value: Double? = null,
    val sequence: List<String>? = null,
    val pairs: List<Pairing>? = null,
    @SerialName("audio_status") val audioStatus: AudioStatus? = null,
) {
    @Serializable
    enum class Kind {
        @SerialName("typed")
        TYPED,

        @SerialName("choice")
        CHOICE,

        @SerialName("number")
        NUMBER,

        @SerialName("sequence")
        SEQUENCE,

        @SerialName("pairs")
        PAIRS,

        @SerialName("dont_know")
        DONT_KNOW,
    }

    @Serializable
    data class Pairing(
        val left: String,
        val right: String,
    )

    companion object {
        const val REF_DONT_KNOW = "dont_know"

        fun typed(
            text: String,
            ref: Referent? = null,
        ) = Response(kind = Kind.TYPED, text = text, ref = ref?.let { refTag(it) })

        fun typedRefUnknown(text: String) = Response(kind = Kind.TYPED, text = text, ref = REF_DONT_KNOW)

        fun choice(optionId: String) = Response(kind = Kind.CHOICE, optionId = optionId)

        fun number(value: Double) = Response(kind = Kind.NUMBER, value = value)

        fun sequence(ids: List<String>) = Response(kind = Kind.SEQUENCE, sequence = ids)

        fun pairs(p: List<Pairing>) = Response(kind = Kind.PAIRS, pairs = p)

        fun dontKnow() = Response(kind = Kind.DONT_KNOW)

        fun refTag(r: Referent): String = if (r == Referent.PEREMPUAN) "perempuan" else "laki-laki"
    }
}
