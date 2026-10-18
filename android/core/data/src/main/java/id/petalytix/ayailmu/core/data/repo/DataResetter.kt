package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.data.settings.DailyPuzzleStore
import id.petalytix.ayailmu.core.data.settings.ProfileChoiceStore
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import id.petalytix.ayailmu.core.data.settings.TrialStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * «Hapus semua data» (CR-DAT-4): every table, the active-profile setting, the daily reminder (back to off),
 * the daily puzzle marks, the trial switches (tester access, survey snoozes), every profile's module choices and
 * avatar (follow-up 12) and any exported files. Purchases
 * are not data about the learner and stay with the Google account (they come back with «Pulihkan pembelian»).
 */
class DataResetter(
    private val db: AyaDatabase,
    private val active: ActiveProfileStore,
    private val reminders: ReminderStore? = null,
    private val puzzles: DailyPuzzleStore? = null,
    private val trial: TrialStore? = null,
    private val choices: ProfileChoiceStore? = null,
    private val clearFiles: () -> Unit,
) {
    suspend fun deleteAll() {
        withContext(Dispatchers.IO) {
            db.clearAllTables()
            clearFiles()
        }
        active.setActive(null)
        reminders?.set(ReminderSetting())
        puzzles?.clear()
        trial?.clear()
        choices?.clear()
    }
}
