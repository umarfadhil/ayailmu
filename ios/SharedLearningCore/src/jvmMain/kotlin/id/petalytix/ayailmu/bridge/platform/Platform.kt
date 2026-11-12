package id.petalytix.ayailmu.bridge.platform

typealias Instant = java.time.Instant
typealias ZoneId = java.time.ZoneId
typealias LocalDate = java.time.LocalDate
typealias ChronoUnit = java.time.temporal.ChronoUnit
object Normalizer {
    enum class Form { NFKC }
    fun normalize(text: String, form: Form): String {
        require(form == Form.NFKC)
        return java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC)
    }
}
fun randomUUID(): String = java.util.UUID.randomUUID().toString()

class UnicodePattern(pattern: String) {
    private val regex = kotlin.text.Regex(pattern)
    fun replace(input: String,replacement: String): String = regex.replace(input,replacement)
}
fun String.replace(pattern: UnicodePattern,replacement: String): String = pattern.replace(this,replacement)
