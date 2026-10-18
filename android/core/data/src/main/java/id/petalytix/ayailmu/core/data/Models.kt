package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang

/** Facts about the running build the data layer needs; provided by :app (BuildConfig). */
data class AppBuildInfo(
    val developerDemo: Boolean,
    val appVersion: String,
)

enum class ProfileKind { ADULT, ANAK }

/** A learner on this device. No name, email or contact is ever required (CR-DAT-2). */
data class Profile(
    val id: String,
    val label: String,
    val kind: ProfileKind,
    val createdBy: String?,
    val birthYear: Int?,
    val audience: Audience,
    val lang: Lang,
    val createdAtMs: Long,
    val sessionMinutes: Int?,
    val arabicScale: Float,
    val screensSeen: List<String>,
    val consentVersion: String?,
)

/** A learner's «Laporkan soal» report (Trial_App_Spec §5). */
data class ItemReport(
    val reportId: String,
    val profileId: String,
    val itemId: String,
    val contentVersion: String,
    val timestamp: String,
    val reason: String,
    val text: String,
)

/**
 * A trial questionnaire (Trial_App_Spec §10): [kind] is "background" (E-B1..E-B4, after consent), "day7" or
 * "end". [answers] maps a question id to the chosen option ids or the typed text (one element).
 */
data class SurveyRecord(
    val surveyId: String,
    val profileId: String,
    val track: String,
    val kind: String,
    val timestamp: String,
    val appVersion: String,
    val answers: Map<String, List<String>>,
)

/** A finished unit challenge; the unit's sticker is earned by it (P6). */
data class UnitChallenge(
    val challengeId: String,
    val profileId: String,
    val track: String,
    val unit: String,
    val completedAt: String,
)
