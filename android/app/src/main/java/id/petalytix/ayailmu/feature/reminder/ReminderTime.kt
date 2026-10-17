package id.petalytix.ayailmu.feature.reminder

import java.time.ZonedDateTime

/** Pure timing for the daily reminder (unit-tested; the Android scheduler only calls this). */
object ReminderTime {
    /** The next time today at [hour]:[minute], or tomorrow if that moment has already passed (zone-aware, DST-safe). */
    fun next(
        now: ZonedDateTime,
        hour: Int,
        minute: Int,
    ): ZonedDateTime {
        val today = now.toLocalDate().atTime(hour, minute).atZone(now.zone)
        return if (today.isAfter(now)) today else now.toLocalDate().plusDays(1).atTime(hour, minute).atZone(now.zone)
    }

    /** Android may deliver an inexact alarm within this window; no exact-alarm permission is needed. */
    const val WINDOW_MS = 30L * 60L * 1000L
}
