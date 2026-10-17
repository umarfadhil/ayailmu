package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * «Hapus semua data» (CR-DAT-4): every table, the active-profile setting, the daily reminder (back to off)
 * and any exported files.
 */
class DataResetter(
    private val db: AyaDatabase,
    private val active: ActiveProfileStore,
    private val reminders: ReminderStore? = null,
    private val clearFiles: () -> Unit,
) {
    suspend fun deleteAll() {
        withContext(Dispatchers.IO) {
            db.clearAllTables()
            clearFiles()
        }
        active.setActive(null)
        reminders?.set(ReminderSetting())
    }
}
