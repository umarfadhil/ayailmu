package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.content.ContentJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate

/**
 * The Arabic trial's app-level settings in `config/app_config.json` (CR-CFG-1: bundled, versioned, validated;
 * nothing here has a hidden default in code).
 *
 * - [surveyDay]: the day-7 survey is offered this many days after the profile's first answer on [track].
 * - [endSurveyFrom]: ISO date from which the end-of-trial survey is offered; null = not yet.
 * - [testerCodeHashes]: SHA-256 (lower-case hex) of the closed-test tester codes (`android/tools/tester_code.py`);
 *   the codes themselves are never committed.
 * - [testerUntil]: the last day (ISO date, inclusive) on which a tester code opens every unit. Required whenever
 *   [testerCodeHashes] is not empty, so a leaked code cannot open the paid packs for ever; after that day, or
 *   once a later build ships with no hashes, the stored tester switch is ignored.
 */
@Serializable
data class TrialConfig(
    val track: String,
    @SerialName("survey_day") val surveyDay: Int,
    @SerialName("end_survey_from") val endSurveyFrom: String?,
    @SerialName("tester_code_hashes") val testerCodeHashes: List<String>,
    @SerialName("tester_until") val testerUntil: String?,
) {
    /** Empty when valid; otherwise what is wrong (the trial features stay off). */
    fun problems(): List<String> {
        val p = mutableListOf<String>()
        if (track.isBlank()) p += "trial.track is blank"
        if (surveyDay !in 1..60) p += "trial.survey_day $surveyDay outside 1..60"
        if (endSurveyFrom != null && runCatching { LocalDate.parse(endSurveyFrom) }.isFailure) p += "trial.end_survey_from is not a date"
        testerCodeHashes.filterNot { HEX64.matches(it) }.forEach { p += "trial.tester_code_hashes: not a SHA-256 hex: $it" }
        if (testerUntil != null && date(testerUntil) == null) p += "trial.tester_until is not a date"
        if (testerCodeHashes.isNotEmpty() && testerUntil == null) p += "trial.tester_until is required when tester_code_hashes is set"
        return p
    }

    /** True while tester codes are honoured: this build lists some, and [today] is on or before [testerUntil]. */
    fun testerOpen(today: LocalDate): Boolean {
        val until = testerUntil?.let { date(it) } ?: return false
        return testerCodeHashes.isNotEmpty() && !today.isAfter(until)
    }

    private fun date(s: String): LocalDate? = runCatching { LocalDate.parse(s) }.getOrNull()

    private companion object {
        val HEX64 = Regex("^[0-9a-f]{64}$")
    }
}

@Serializable
data class AppConfig(
    @SerialName("config_version") val configVersion: Int,
    val trial: TrialConfig,
)

/** Reads `config/app_config.json` once per process; throws when it is missing or invalid (callers degrade). */
class AppConfigRepository(
    private val assets: AssetSource,
) {
    private val lock = Mutex()
    private var cache: AppConfig? = null

    suspend fun config(): AppConfig =
        lock.withLock {
            cache ?: withContext(Dispatchers.IO) {
                val c = ContentJson.json.decodeFromString(AppConfig.serializer(), assets.read(PATH))
                val problems = c.trial.problems()
                require(problems.isEmpty()) { "app_config.json: " + problems.joinToString("; ") }
                c
            }.also { cache = it }
        }

    suspend fun trial(): TrialConfig = config().trial

    companion object {
        const val PATH = "config/app_config.json"
    }
}
