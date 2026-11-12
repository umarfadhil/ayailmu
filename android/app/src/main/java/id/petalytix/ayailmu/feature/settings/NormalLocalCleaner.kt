package id.petalytix.ayailmu.feature.settings

/** Flavor-owned cleanup keeps account actions fenced through the entire caller-supplied device reset. */
interface NormalLocalCleaner {
    suspend fun deleteProfile(profileId: String)
    suspend fun deleteDevice(remainingDeviceCleanup: suspend () -> Unit)
}
object NoNormalLocalCleaner : NormalLocalCleaner {
    override suspend fun deleteProfile(profileId: String) = Unit
    override suspend fun deleteDevice(remainingDeviceCleanup: suspend () -> Unit) = remainingDeviceCleanup()
}
