package id.petalytix.ayailmu.feature.reminder

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import id.petalytix.ayailmu.MainActivity
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.engine.Clock
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The one daily reminder (CR-HAB-5) on the device's AlarmManager: a single inexact alarm for the next
 * occurrence, re-armed each time it fires, after a reboot, a time or zone change and an app update. No
 * internet, no server, no exact-alarm permission. Calm copy only (CR-HAB-2, CR-HAB-6).
 */
@Singleton
class ReminderScheduler
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val clock: Clock,
    ) {
        private val alarms: AlarmManager? get() = ContextCompat.getSystemService(context, AlarmManager::class.java)

        /** Arms the alarm only if none is pending (or cancels it when the reminder is off). Used at start-up. */
        fun ensure(setting: ReminderSetting) {
            val pending = existingPendingIntent()
            if (!setting.enabled || pending == null) apply(setting)
        }

        /** Arms or cancels the alarm to match [setting]. Safe to call repeatedly. */
        fun apply(setting: ReminderSetting) {
            val pi = firePendingIntent(setting)
            val manager = alarms ?: return
            manager.cancel(pi)
            if (!setting.enabled) {
                pi.cancel() // so ensure() sees "no alarm" next time
                return
            }
            val at = ReminderTime.next(clock.now().atZone(clock.zone), setting.hour, setting.minute)
            manager.setWindow(AlarmManager.RTC_WAKEUP, at.toInstant().toEpochMilli(), ReminderTime.WINDOW_MS, pi)
        }

        /** Posts the notification (if Android allows it) in the language of the adult who set the reminder. */
        fun post(lang: String) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }
            val localized = localizedContext(lang)
            ensureChannel(localized)
            val open =
                PendingIntent.getActivity(
                    context,
                    REQUEST_OPEN,
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            val notification =
                NotificationCompat
                    .Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(localized.getString(R.string.reminder_title))
                    .setContentText(localized.getString(R.string.reminder_body))
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        }

        private fun ensureChannel(localized: Context) {
            val manager = ContextCompat.getSystemService(context, NotificationManager::class.java) ?: return
            val channel =
                NotificationChannel(CHANNEL_ID, localized.getString(R.string.reminder_channel_name), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = localized.getString(R.string.reminder_channel_description)
                }
            manager.createNotificationChannel(channel)
        }

        private fun localizedContext(lang: String): Context {
            val config = Configuration(context.resources.configuration)
            config.setLocale(Locale.forLanguageTag(lang))
            return context.createConfigurationContext(config)
        }

        private fun firePendingIntent(setting: ReminderSetting): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                REQUEST_FIRE,
                Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_FIRE).putExtra(ReminderReceiver.EXTRA_LANG, setting.lang),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        private fun existingPendingIntent(): PendingIntent? =
            PendingIntent.getBroadcast(
                context,
                REQUEST_FIRE,
                Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_FIRE),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )

        companion object {
            const val CHANNEL_ID = "daily_reminder"
            private const val NOTIFICATION_ID = 1001
            private const val REQUEST_FIRE = 2001
            private const val REQUEST_OPEN = 2002
        }
    }
