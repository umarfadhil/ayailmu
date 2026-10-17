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
