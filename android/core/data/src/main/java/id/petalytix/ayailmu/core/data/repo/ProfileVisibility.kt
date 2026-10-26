package id.petalytix.ayailmu.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/** Flavor-owned boundary between device-local profiles and an authenticated normal owner. */
data class ProfileOwnership(val environmentId: String, val ownerId: String)
interface ProfileVisibility {
    val changes: Flow<Unit>
    fun allows(profileId: String): Boolean
    fun ownership(profileId: String): ProfileOwnership? = null
}
object AllowAllProfiles : ProfileVisibility {
    override val changes: Flow<Unit> = flowOf(Unit)
    override fun allows(profileId: String) = true
}
