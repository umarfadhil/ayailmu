package id.petalytix.ayailmu.feature.trial

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.TrialConfig
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.feature.consent.Consent
import java.security.MessageDigest
import java.time.LocalDate

/** The three trial questionnaires (Trial_App_Spec §4 step 3 and §10). [code] is what is stored and exported. */
enum class SurveyKind(
    val code: String,
) {
    BACKGROUND("background"),
    DAY7("day7"),
    END("end"),
    ;

    companion object {
        fun of(code: String): SurveyKind? = entries.firstOrNull { it.code == code }
    }
}

enum class QuestionType { SINGLE, MULTI, TEXT }

/** One question. Option ids are stable (exported); their wording lives in strings.xml (id + en). */
data class SurveyQuestion(
    val id: String,
    val type: QuestionType,
    val options: List<String> = emptyList(),
)

/**
 * Question sets. Background = E-B1..E-B4 from docs/Lessons_Unit_A_B_Draft.md §1.1 (recorded only; E-B4 sets the
 * default session length). Day 7 and end of trial = the short survey of Trial_App_Spec §10. Nothing is required:
 * every question may stay empty, and the whole form may be skipped.
 */
object SurveyForms {
    const val MAX_TEXT = 500

    val BACKGROUND: List<SurveyQuestion> =
        listOf(
            SurveyQuestion("e_b1", QuestionType.MULTI, listOf("tpa", "iqra", "pesantren", "madrasah", "self", "other")),
            SurveyQuestion("e_b2", QuestionType.SINGLE, listOf("daily", "weekly", "rarely", "almost_never")),
            SurveyQuestion("e_b3", QuestionType.SINGLE, listOf("never", "a_little", "quite_a_lot")),
            SurveyQuestion("e_b4", QuestionType.SINGLE, listOf("10", "15", "20")),
        )

    val TRIAL: List<SurveyQuestion> =
        listOf(
            SurveyQuestion("clarity", QuestionType.SINGLE, listOf("1", "2", "3", "4", "5")),
            SurveyQuestion("hardest", QuestionType.TEXT),
            SurveyQuestion("continue", QuestionType.SINGLE, listOf("yes", "maybe", "no")),
            SurveyQuestion("daily_minutes", QuestionType.SINGLE, listOf("lt5", "5_10", "10_15", "15_20", "gt20")),
            SurveyQuestion("confusing", QuestionType.TEXT),
        )

    fun of(kind: SurveyKind): List<SurveyQuestion> = if (kind == SurveyKind.BACKGROUND) BACKGROUND else TRIAL

    /**
     * What is stored: only known questions and options, single choices reduced to one, text trimmed to [MAX_TEXT]
     * characters, empty answers dropped. A skipped form stores an empty map (so it is not asked again).
     */
    fun clean(
        kind: SurveyKind,
        answers: Map<String, List<String>>,
    ): Map<String, List<String>> {
        val out = linkedMapOf<String, List<String>>()
        for (q in of(kind)) {
            val raw = answers[q.id].orEmpty()
            val value =
                when (q.type) {
                    QuestionType.SINGLE -> raw.filter { it in q.options }.take(1)
                    QuestionType.MULTI -> q.options.filter { it in raw }
                    QuestionType.TEXT -> raw.firstOrNull()?.trim()?.take(MAX_TEXT)?.takeIf { it.isNotEmpty() }?.let { listOf(it) }.orEmpty()
                }
            if (value.isNotEmpty()) out[q.id] = value
        }
        return out
    }

    /** E-B4: the learner's chosen daily minutes, if answered. */
    fun sessionMinutes(answers: Map<String, List<String>>): Int? = answers["e_b4"]?.firstOrNull()?.toIntOrNull()
}

/** When a trial survey is offered (Trial_App_Spec §4 step 10: "at about day 7 and at the end of the trial"). */
object SurveyRules {
    /** Enough practice that the day-7 questions make sense. */
    const val MIN_PRACTICE_DAYS = 3

    /**
     * The survey to offer today, or null. [firstAnswer] is the local date of the profile's first trial answer,
     * [practiceDays] the number of different days it practised. End of trial wins over day 7 and replaces it.
     */
    fun due(
        today: LocalDate,
        firstAnswer: LocalDate?,
        practiceDays: Int,
        done: Set<SurveyKind>,
        surveyDay: Int,
        endFrom: LocalDate?,
        snoozedToday: Boolean = false,
    ): SurveyKind? {
        if (snoozedToday || firstAnswer == null) return null
        if (endFrom != null && !today.isBefore(endFrom) && SurveyKind.END !in done) return SurveyKind.END
        val day7Open = !today.isBefore(firstAnswer.plusDays(surveyDay.toLong())) && practiceDays >= MIN_PRACTICE_DAYS
        return if (day7Open && SurveyKind.DAY7 !in done && SurveyKind.END !in done) SurveyKind.DAY7 else null
    }

    /**
     * [due] for one profile: only an adult who consented to the current trial text is asked; [history] is that
     * profile's answers on the trial track. Home passes [snoozedToday] ("Nanti saja"); Settings does not.
     * The background questions come first: a profile that consented without reaching them (an earlier build,
     * or the app closed on that screen) is offered them until they are answered or skipped.
     */
    fun forProfile(
        profile: Profile,
        trial: TrialConfig,
        history: List<AnswerEvent>,
        done: Set<SurveyKind>,
        today: LocalDate,
        snoozedToday: Boolean = false,
    ): SurveyKind? {
        if (profile.kind != ProfileKind.ADULT || profile.consentVersion != Consent.VERSION) return null
        if (SurveyKind.BACKGROUND !in done) return if (snoozedToday) null else SurveyKind.BACKGROUND
        val days = history.mapNotNull { runCatching { LocalDate.parse(it.localDate) }.getOrNull() }.distinct()
        val endFrom = trial.endSurveyFrom?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        return due(today, days.minOrNull(), days.size, done, trial.surveyDay, endFrom, snoozedToday)
    }
}

/**
 * Closed-test tester codes (CR-BIL-7). The app keeps only SHA-256 hashes (`trial.tester_code_hashes`); a code is
 * compared after trimming and upper-casing, the same as `android/tools/tester_code.py`. Codes are 20 random
 * characters (about 100 bits) so the hashes in the APK cannot be guessed back, and they open units only until
 * `trial.tester_until` ([TrialConfig.testerOpen]).
 */
object TesterCode {
    fun normalise(code: String): String = code.trim().uppercase()

    fun hash(code: String): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(normalise(code).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun matches(
        code: String,
        hashes: Collection<String>,
    ): Boolean = normalise(code).isNotEmpty() && hash(code) in hashes
}
