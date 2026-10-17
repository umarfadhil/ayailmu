package id.petalytix.ayailmu.feature.consent

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.model.TrackMode

/**
 * Trial consent (Trial_App_Spec §4 step 2, §11). Evidence tracks (the Arabic trial) need it before the first
 * session; casual tracks do not. Changing the consent text means bumping [VERSION], which asks everyone again.
 */
object Consent {
    const val VERSION = "arab-trial-1"

    fun required(
        mode: TrackMode,
        profile: Profile,
    ): Boolean = mode == TrackMode.EVIDENCE && profile.consentVersion != VERSION

    /** The trial is for adults 18+ (Trial_App_Spec §11). Adult profiles start at 13, so the birth year decides too. */
    const val MIN_AGE = 18

    /** Uses the younger possible age from a birth year (same rule as onboarding); unknown year → the checkbox decides. */
    fun oldEnough(
        birthYear: Int?,
        currentYear: Int,
    ): Boolean = birthYear == null || currentYear - birthYear - 1 >= MIN_AGE
}
