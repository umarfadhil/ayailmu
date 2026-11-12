@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package id.petalytix.ayailmu.bridge.platform

import platform.Foundation.*
import kotlin.math.floor

object Normalizer {
    enum class Form { NFKC }
    fun normalize(text: String, form: Form): String {
        require(form == Form.NFKC)
        return (text as NSString).precomposedStringWithCompatibilityMapping
    }
}
fun randomUUID(): String = NSUUID().UUIDString.lowercase()
class ZoneId private constructor(val id: String) {
    companion object { fun of(id: String): ZoneId { require(NSTimeZone.timeZoneWithName(id) != null); return ZoneId(id) } }
}
private fun dateFormatter(zone: String = "UTC") = NSDateFormatter().apply {
    locale = NSLocale(localeIdentifier = "en_US_POSIX")
    timeZone = requireNotNull(NSTimeZone.timeZoneWithName(zone))
    dateFormat = "yyyy-MM-dd"; lenient = false
}
class Instant private constructor(private val epochMs: Long) {
    companion object {
        fun ofEpochMilli(value: Long) = Instant(value)
        fun parse(value: String): Instant {
            // Parse the whole second with Foundation, then truncate decimal nanos exactly as JVM
            // Instant.toEpochMilli. Floating-point rounding must not move a boundary millisecond.
            val fraction = Regex("\\.([0-9]{1,9})(?=Z|[+-][0-9]{2}:[0-9]{2}$)").find(value)
            val whole = fraction?.let { value.removeRange(it.range) } ?: value
            LocalDate.parse(whole.take(10))
            val formatter = NSISO8601DateFormatter(); formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime
            val date = requireNotNull(formatter.dateFromString(whole))
            val milliseconds = fraction?.groupValues?.get(1)?.padEnd(3,'0')?.take(3)?.toLong() ?: 0L
            return Instant(floor(date.timeIntervalSince1970).toLong() * 1000L + milliseconds)
        }
    }
    fun toEpochMilli(): Long = epochMs
    fun atZone(zone: ZoneId): Zoned = Zoned(epochMs,zone)
    override fun toString(): String {
        val formatter = NSISO8601DateFormatter()
        formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime or NSISO8601DateFormatWithFractionalSeconds
        return formatter.stringFromDate(NSDate.dateWithTimeIntervalSince1970(epochMs / 1000.0)).replace(".000Z", "Z")
    }
}
class Zoned(private val epochMs: Long, private val zone: ZoneId) {
    fun toLocalDate(): LocalDate = LocalDate.parse(dateFormatter(zone.id).stringFromDate(NSDate.dateWithTimeIntervalSince1970(epochMs / 1000.0)))
}
class LocalDate private constructor(private val value: String) {
    companion object {
        fun parse(value: String): LocalDate {
            val formatter = dateFormatter(); val date = requireNotNull(formatter.dateFromString(value))
            require(formatter.stringFromDate(date) == value)
            return LocalDate(value)
        }
    }
    internal fun date(): NSDate = requireNotNull(dateFormatter().dateFromString(value))
    fun plusDays(days: Long): LocalDate {
        val calendar = requireNotNull(NSCalendar(calendarIdentifier = NSCalendarIdentifierGregorian))
        calendar.timeZone = requireNotNull(NSTimeZone.timeZoneWithName("UTC"))
        val next = requireNotNull(calendar.dateByAddingUnit(NSCalendarUnitDay,days,date(),0uL))
        return parse(dateFormatter().stringFromDate(next))
    }
    override fun toString(): String = value
}
object ChronoUnit {
    object DAYS {
        fun between(from: LocalDate,to: LocalDate): Long {
            val calendar = requireNotNull(NSCalendar(calendarIdentifier = NSCalendarIdentifierGregorian))
            calendar.timeZone = requireNotNull(NSTimeZone.timeZoneWithName("UTC"))
            return calendar.components(NSCalendarUnitDay,from.date(),to.date(),0uL).day
        }
    }
}

/** ICU provides the Unicode letter/number classes absent from Kotlin/Native Regex2.2.
 * Java's default \s is ASCII; expand it explicitly rather than ICU's wider Unicode whitespace set.
 */
class UnicodePattern(pattern: String) {
    private val expression = requireNotNull(NSRegularExpression.regularExpressionWithPattern(pattern.replace("\\s","\\x20\\t\\n\\x0B\\f\\r"),0uL,null))
    fun replace(input: String,replacement: String): String = expression.stringByReplacingMatchesInString(input,0uL,NSMakeRange(0uL,(input as NSString).length),replacement)
}
fun String.replace(pattern: UnicodePattern,replacement: String): String = pattern.replace(this,replacement)
