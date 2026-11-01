package id.petalytix.ayailmu.feature.settings

/** Flavor-owned cleanup for normal account/session stores outside Room. */
interface NormalLocalCleaner {
    suspend fun deleteProfile(profileId: String)
    suspend fun deleteDevice()
}
object NoNormalLocalCleaner : NormalLocalCleaner {
    override suspend fun deleteProfile(profileId: String) = Unit
    override suspend fun deleteDevice() = Unit
}
