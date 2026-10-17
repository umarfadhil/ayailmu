package id.petalytix.ayailmu.feature.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Fires the daily reminder and re-arms the next one; also re-arms after reboot, time/zone change and app
 * update (alarms do not survive those). Reads the current setting, so a reminder turned off in the meantime
 * never fires.
 */
@AndroidEntryPoint
class ReminderReceiver : BroadcastReceiver() {
    @Inject lateinit var store: ReminderStore

    @Inject lateinit var scheduler: ReminderScheduler

    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                val setting = store.reminder.first()
                if (intent.action == ACTION_FIRE && setting.enabled) scheduler.post(setting.lang)
                scheduler.apply(setting)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_FIRE = "id.petalytix.ayailmu.action.REMINDER_FIRE"
        const val EXTRA_LANG = "lang"
    }
}
