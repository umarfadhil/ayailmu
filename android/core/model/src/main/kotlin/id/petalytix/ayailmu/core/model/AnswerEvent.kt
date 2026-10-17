package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One immutable answer event (Trial_App_Spec §10, CR-ARC-4). Every answer is stored; skill states are a
 * projection recomputable from these plus a `RuleConfig` version. Field names are snake_case in JSON so the
 * export (CR-DAT-4) and the prototype's analysis scripts line up.
 */
@Serializable
data class AnswerEvent(
    @SerialName("answer_id") val answerId: String,
    @SerialName("learner_id") val learnerId: String,
    @SerialName("item_id") val itemId: String,
    val track: String,
    @SerialName("content_version") val contentVersion: String,
    @SerialName("rules_version") val rulesVersion: String,
    @SerialName("app_version") val appVersion: String,
    /** ISO-8601 instant. */
    val timestamp: String,
    /** Local calendar date YYYY-MM-DD in the learner's zone. "Later session" = different local date. */
    @SerialName("local_date") val localDate: String,
    @SerialName("session_id") val sessionId: String,
    val lang: Lang,
    val pool: Pool,
    val unit: String,
    val skills: List<String>,
    /** Exactly what was tapped or typed, as JSON of [Response]. */
    @SerialName("raw_response") val rawResponse: String,
    @SerialName("auto_score") val autoScore: Map<String, PartScore>,
    val outcome: Outcome,
    @SerialName("error_tags") val errorTags: List<ErrorTag> = emptyList(),
    @SerialName("serious_tag") val seriousTag: ErrorTag? = null,
    @SerialName("hint_used") val hintUsed: Boolean = false,
    @SerialName("help_lines_shown") val helpLinesShown: List<String> = emptyList(),
    @SerialName("first_attempt") val firstAttempt: Boolean,
    @SerialName("fresh_evidence") val freshEvidence: Boolean,
    /** Analysis only; never used to judge the learner. */
    @SerialName("time_on_item_ms") val timeOnItemMs: Long = 0,
    @SerialName("audio_status") val audioStatus: AudioStatus? = null,
    @SerialName("report_flag") val reportFlag: Boolean = false,
    @SerialName("review_status") val reviewStatus: ReviewStatus,
    val synthetic: Boolean = false,
    /** Practice-only item types and hinted items never carry evidence (CR-ENG-9). */
    @SerialName("item_type") val itemType: ItemType,
    val gem: Boolean = false,
)
