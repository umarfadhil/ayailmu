package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.TrackMode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Learning rules for one track (`content/config/rules.<track>.json`, CR-CFG-1, Trial_App_Spec §7, framework §3).
 * Every value the engine uses comes from here; the engine refuses to run without a valid config.
 */
@Serializable
data class RuleConfig(
    @SerialName("rules_version") val rulesVersion: String,
    val track: String,
    val mode: TrackMode,
    @SerialName("typo_tolerance") val typoTolerance: TypoTolerance,
    @SerialName("review_spacing_days") val reviewSpacingDays: List<Int>,
    @SerialName("review_share_max") val reviewShareMax: Double,
    @SerialName("binary_streak") val binaryStreak: Int,
    @SerialName("binary_min_days") val binaryMinDays: Int,
    @SerialName("tile_counts_as_free") val tileCountsAsFree: Boolean,
    @SerialName("session_minutes_options") val sessionMinutesOptions: List<Int>,
    @SerialName("default_session_minutes") val defaultSessionMinutes: Int,
    @SerialName("items_per_minute") val itemsPerMinute: Double = 1.0,
    @SerialName("ready_after_practice_attempts") val readyAfterPracticeAttempts: Int,
    @SerialName("check_days") val checkDays: CheckDays,
    val learned: LearnedRule,
    @SerialName("word_learned_days") val wordLearnedDays: Int = 2,
    @SerialName("typed_rules") val typedRules: Map<String, TypedRules> = emptyMap(),
) {
    @Serializable
    data class TypoTolerance(
        @SerialName("min_word_length") val minWordLength: Int,
        @SerialName("max_edits") val maxEdits: Int,
    )

    @Serializable
    data class CheckDays(
        @SerialName("D7") val d7: Int,
        @SerialName("D30") val d30: Int,
    )

    @Serializable
    data class LearnedRule(
        val window: Int,
        @SerialName("min_correct") val minCorrect: Int,
        @SerialName("min_typed_or_built") val minTypedOrBuilt: Int = 0,
        @SerialName("min_distinct_items") val minDistinctItems: Int = 1,
        @SerialName("min_ready") val minReady: Int = 0,
        @SerialName("require_later_day") val requireLaterDay: Boolean = true,
    )

    @Serializable
    data class TypedRules(
        @SerialName("negation_words") val negationWords: List<String> = emptyList(),
        @SerialName("possession_words") val possessionWords: List<String> = emptyList(),
        @SerialName("action_words") val actionWords: List<String> = emptyList(),
    )

    fun typed(lang: Lang): TypedRules = typedRules[lang.tag] ?: TypedRules()

    /** Problems with this config; empty when valid. Mirrors the prototype's `validateRules`. */
    fun problems(): List<String> {
        val p = mutableListOf<String>()
        if (rulesVersion.isBlank()) p += "rules_version"
        if (track.isBlank()) p += "track"
        if (typoTolerance.minWordLength < 1 || typoTolerance.maxEdits < 0) p += "typo_tolerance"
        if (reviewSpacingDays.isEmpty() || reviewSpacingDays.any { it <= 0 }) p += "review_spacing_days"
        if (reviewShareMax < 0.0 || reviewShareMax > 1.0) p += "review_share_max"
        if (binaryStreak <= 0) p += "binary_streak"
        if (binaryMinDays < 0) p += "binary_min_days"
        if (sessionMinutesOptions.isEmpty() || sessionMinutesOptions.any { it <= 0 }) p += "session_minutes_options"
        if (defaultSessionMinutes !in sessionMinutesOptions) p += "default_session_minutes"
        if (itemsPerMinute <= 0.0) p += "items_per_minute"
        if (readyAfterPracticeAttempts < 0) p += "ready_after_practice_attempts"
        if (checkDays.d7 <= 0 || checkDays.d30 <= checkDays.d7) p += "check_days"
        if (learned.window <= 0 || learned.minCorrect <= 0 || learned.minCorrect > learned.window) p += "learned"
        if (wordLearnedDays <= 0) p += "word_learned_days"
        return p
    }

    companion object {
        fun parse(text: String): RuleConfig {
            val cfg = ContentJson.json.decodeFromString(serializer(), text)
            val problems = cfg.problems()
            require(problems.isEmpty()) { "Invalid rules config: ${problems.joinToString(", ")}" }
            return cfg
        }
    }
}
