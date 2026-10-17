package id.petalytix.ayailmu

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import id.petalytix.ayailmu.feature.reminder.ReminderScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Application entry point. Hilt graph root (CR-ARC-5). No SDK initialisation here, by design (CR-DAT-3).
 * The only thing started here is keeping the daily reminder alarm in step with its setting.
 */
@HiltAndroidApp
class AyaIlmuApp : Application() {
    @Inject lateinit var reminders: ReminderStore

    @Inject lateinit var reminderScheduler: ReminderScheduler

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        appScope.launch {
            var first = true
            reminders.reminder
                .distinctUntilChanged()
                .catch { /* settings unreadable: leave alarms as they are */ }
                .collect { setting ->
                    // At start-up only re-arm a missing alarm (e.g. after "force stop"), so opening the app inside
                    // the delivery window never pushes today's reminder to tomorrow. Later changes always apply.
                    runCatching { if (first) reminderScheduler.ensure(setting) else reminderScheduler.apply(setting) }
                    first = false
                }
        }
    }
}
