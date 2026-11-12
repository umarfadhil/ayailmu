package id.petalytix.ayailmu.feature.account

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.feature.settings.NormalLocalCleaner
import java.io.File
import javax.inject.Inject

internal class NormalAccountLocalCleaner @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: NormalSyncRepository,
    private val account: NormalAccount,
    private val visibility: NormalProfileVisibility,
    private val erasure: NormalAccountErasure,
) : NormalLocalCleaner {
    override suspend fun deleteProfile(profileId: String) {
        check(visibility.allows(profileId)) { "Profile is not available in this owner context" }
        repository.deleteProfile(profileId)
    }
    override suspend fun deleteDevice(remainingDeviceCleanup: suspend () -> Unit) {
        // Cancel first: no late credential operation may repopulate state between the engine/vault/file clears.
        erasure.cancelForDeviceReset()
        account.cancel()
        repository.deleteDevice()
        account.clearLocalAuthState()
        val root = context.noBackupFilesDir
        for (name in NORMAL_NAMESPACES) {
            val directory = File(root, name)
            check(!directory.exists() || directory.deleteRecursively()) { "Normal local data cleanup failed" }
        }
        visibility.refresh()
        // Room, profiles, settings and exported files belong to the same reset boundary.
        // Any exception/cancellation keeps account actions closed until a later successful reset.
        remainingDeviceCleanup()
        erasure.finishDeviceReset()
    }
    private companion object {
        val NORMAL_NAMESPACES = setOf("normal-owner-auth", "normal-owner-sync")
    }
}
