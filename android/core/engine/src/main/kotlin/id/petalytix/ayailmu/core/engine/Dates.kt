package id.petalytix.ayailmu.core.engine

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Calendar-date helpers over ISO strings (YYYY-MM-DD). "Later session" = a different local date (spec §6). */
object Dates {
    fun localDate(
        epochMs: Long,
        zone: ZoneId,
    ): String = Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate().toString()

    fun addDays(
        date: String,
        days: Long,
    ): String = LocalDate.parse(date).plusDays(days).toString()

    fun daysBetween(
        from: String,
        to: String,
    ): Long = ChronoUnit.DAYS.between(LocalDate.parse(from), LocalDate.parse(to))
}

/** Random ids for sessions and answers; injectable so tests and replays are deterministic. */
fun interface IdGenerator {
    fun newId(prefix: String): String
}

object UuidIdGenerator : IdGenerator {
    override fun newId(prefix: String): String = "$prefix-${java.util.UUID.randomUUID()}"
}

/** Sequential ids for tests. */
class CountingIdGenerator : IdGenerator {
    private var n = 0

    override fun newId(prefix: String): String = "$prefix-${++n}"
}
