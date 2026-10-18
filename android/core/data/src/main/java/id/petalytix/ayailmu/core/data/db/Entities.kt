package id.petalytix.ayailmu.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// Room schema v1 (CR-DAT-1). Events are stored as their full JSON payload plus a few indexed columns, so
// the event format can grow without a migration and every projection stays recomputable (CR-ARC-4).
// No personal data beyond a free-text label and an optional birth year (CR-DAT-2, CR-DAT-5).

@Entity(tableName = "profiles")
data class ProfileEntity(
    @PrimaryKey val id: String,
    /** Free text, may be a nickname. Never exported. */
    val label: String,
    /** ADULT or ANAK. */
    val kind: String,
    /** Only Anak profiles may be created from an existing Adult profile; this is that adult's id. */
    @ColumnInfo(name = "created_by") val createdBy: String?,
    /** From the neutral age screen; never exported. */
    @ColumnInfo(name = "birth_year") val birthYear: Int?,
    /** Audience enum name: KIDS or ADULTS (follows kind). */
    val audience: String,
    /** "id" or "en" (CR-I18N-2). */
    @ColumnInfo(name = "instruction_lang") val instructionLang: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "session_minutes") val sessionMinutes: Int?,
    @ColumnInfo(name = "arabic_scale") val arabicScale: Float,
    /** JSON array of lesson-screen ids already shown. */
    @ColumnInfo(name = "screens_seen") val screensSeen: String,
    @ColumnInfo(name = "consent_version") val consentVersion: String?,
    @ColumnInfo(name = "consent_at") val consentAt: Long?,
)

@Entity(
    tableName = "answer_events",
    indices = [Index(value = ["profile_id", "track"]), Index(value = ["item_id"])],
)
data class AnswerEventEntity(
    @PrimaryKey @ColumnInfo(name = "answer_id") val answerId: String,
    @ColumnInfo(name = "profile_id") val profileId: String,
    val track: String,
    @ColumnInfo(name = "item_id") val itemId: String,
    @ColumnInfo(name = "local_date") val localDate: String,
    val timestamp: String,
    val outcome: String,
    @ColumnInfo(name = "fresh_evidence") val freshEvidence: Boolean,
    /** The full AnswerEvent as JSON (source of truth). */
    val payload: String,
)

@Entity(tableName = "session_snapshots", primaryKeys = ["profile_id", "track"])
data class SessionSnapshotEntity(
    @ColumnInfo(name = "profile_id") val profileId: String,
    val track: String,
    /** The SessionState as JSON; restored only if it still matches the content version. */
    val payload: String,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(tableName = "item_reports", indices = [Index(value = ["profile_id"])])
data class ItemReportEntity(
    @PrimaryKey @ColumnInfo(name = "report_id") val reportId: String,
    @ColumnInfo(name = "profile_id") val profileId: String,
    @ColumnInfo(name = "item_id") val itemId: String,
    @ColumnInfo(name = "content_version") val contentVersion: String,
    val timestamp: String,
    val reason: String,
    val text: String,
)

/** A trial questionnaire answered on the device (Trial_App_Spec §10): background, day 7 or end of trial. */
@Entity(tableName = "survey_answers", indices = [Index(value = ["profile_id"])])
data class SurveyAnswerEntity(
    @PrimaryKey @ColumnInfo(name = "survey_id") val surveyId: String,
    @ColumnInfo(name = "profile_id") val profileId: String,
    val track: String,
    /** "background", "day7" or "end". */
    val kind: String,
    val timestamp: String,
    @ColumnInfo(name = "app_version") val appVersion: String,
    /** The answers as JSON: question id to a list of chosen option ids or typed text. */
    val payload: String,
)

/** A finished unit challenge (P6): the unit's sticker is earned by it. */
@Entity(tableName = "unit_challenges", indices = [Index(value = ["profile_id"])])
data class UnitChallengeEntity(
    @PrimaryKey @ColumnInfo(name = "challenge_id") val challengeId: String,
    @ColumnInfo(name = "profile_id") val profileId: String,
    val track: String,
    val unit: String,
    @ColumnInfo(name = "completed_at") val completedAt: String,
)
