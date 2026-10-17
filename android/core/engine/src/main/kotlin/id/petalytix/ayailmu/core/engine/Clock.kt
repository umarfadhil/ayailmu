package id.petalytix.ayailmu.core.engine

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * All time in the engine flows through this interface (CR-ARC-3) so sessions can be replayed
 * deterministically and "a later calendar day" (Trial_App_Spec §6) is testable.
 */
interface Clock {
    fun now(): Instant

    val zone: ZoneId

    fun today(): LocalDate = now().atZone(zone).toLocalDate()
}

/** Production clock: device time in the learner's zone. */
class SystemClock(
    override val zone: ZoneId = ZoneId.systemDefault(),
) : Clock {
    override fun now(): Instant = Instant.now()
}

/** Test clock that only moves when told to. */
class FixedClock(
    private var current: Instant,
    override val zone: ZoneId = ZoneId.of("Asia/Jakarta"),
) : Clock {
    override fun now(): Instant = current

    fun set(instant: Instant) {
        current = instant
    }

    fun advanceSeconds(seconds: Long) {
        current = current.plusSeconds(seconds)
    }

    fun advanceDays(days: Long) {
        current = current.atZone(zone).plusDays(days).toInstant()
    }
}
