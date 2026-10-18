package id.petalytix.ayailmu.feature.modules

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.units.UnitPicks
import id.petalytix.ayailmu.feature.units.UnitRow
import java.time.Instant

/**
 * A target language of the Bahasa module (MODULES_LEVELS_STORIES.md section 1), in picker order. [code] is the pack
 * meta `target_lang`; [art] its cover (section 6.1: the script and one everyday object, never a flag). Arabic is the
 * adults' evidence course: children never see it.
 */
enum class ModuleLanguage(
    val code: String,
    val art: String,
    val adultsOnly: Boolean = false,
) {
    ARAB("ar", "cover_lang_arab", adultsOnly = true),
    INGGRIS("en", "cover_lang_inggris"),
    KOREA("ko", "cover_lang_korea"),
    JEPANG("ja", "cover_lang_jepang"),
    MANDARIN("zh", "cover_lang_mandarin"),
    ;

    fun openTo(audience: Audience): Boolean = !adultsOnly || audience == Audience.ADULTS

    companion object {
        fun of(code: String?): ModuleLanguage? = entries.firstOrNull { it.code == code }
    }
}

/** The level badge (section 6.1): one plant growing, seedling to fruiting tree. */
fun Level.artKey(): String =
    when (this) {
        Level.PEMULA -> "level_pemula"
        Level.MENENGAH -> "level_menengah"
        Level.MAHIR -> "level_mahir"
        Level.MASTER -> "level_master"
    }

/** The module a route names by its code ("BHS", "NIL" …); null for an unknown code. */
fun moduleOf(code: String): Subject? = Subject.entries.firstOrNull { it.code == code }

/**
 * What the module model needs to know about one track this profile may see (already filtered by the profile's
 * instruction language and audience, CR-I18N-3). [language] is the pack `target_lang` (Bahasa only).
 */
data class TrackFacts(
    val track: String,
    val subject: Subject,
    val level: Level,
    val language: String? = null,
    /** Units counted as done ([ModuleModel.unitDone]), of all units of the track, and how many are open now. */
    val unitsDone: Int = 0,
    val unitsTotal: Int = 0,
    val unitsOpen: Int = unitsTotal,
    /** This profile's latest answer on the track (epoch ms); null = never practised. */
    val lastActiveMs: Long? = null,
)

/** One rung of the level ladder. [track] null = no track for this audience (and language) yet: «Segera». */
data class LevelRung(
    val level: Level,
    val track: String?,
    val unitsDone: Int = 0,
    val unitsTotal: Int = 0,
    val chosen: Boolean = false,
    /** The next level, offered once >= 80 % of the chosen level's units are done. Never forced (no placement test). */
    val suggested: Boolean = false,
) {
    val comingSoon: Boolean get() = track == null
}

/** One language card of the Bahasa picker. */
data class LanguageOption(
    val language: ModuleLanguage,
    val chosen: Boolean,
)

/**
 * One module as a profile sees it: the language picker (Bahasa only), the four-rung ladder and the resolved choice.
 * [track] is the track «Mulai» starts.
 */
data class ModuleView(
    val subject: Subject,
    val languages: List<LanguageOption>,
    val language: ModuleLanguage?,
    val ladder: List<LevelRung>,
    val level: Level,
    val track: String,
    val suggestion: Level?,
) {
    val chosenRung: LevelRung get() = ladder.first { it.level == level }
}

/**
 * The module model (follow-up 12): loaded tracks grouped into modules for one profile. Bahasa: language, then
 * level; every other module: level. Pure, so Home, the module screen and the tests share one rule.
 *
 * Choosing: the stored choice wins while it still has a track; otherwise the language and level of the track this
 * profile practised last; otherwise the first language in picker order and the lowest level with a track.
 *
 * "Unit done" ([unitDone]): every practice question of the unit answered at least once, whatever the result (the
 * same moment its unit challenge opens, UnitRow.practiceDone), or its challenge finished. Locked units count in the
 * total, so a free learner is never told a level is nearly done when most of it is still closed.
 */
object ModuleModel {
    /** Share of a level's units that must be done before the next level is suggested (section 1). */
    const val SUGGEST_PERCENT = 80

    fun unitDone(row: UnitRow): Boolean = row.practiceDone || row.challengeDone

    fun ready(
        done: Int,
        total: Int,
    ): Boolean = total > 0 && done * 100 >= total * SUGGEST_PERCENT

    /** Facts for one track from this profile's answers and finished challenges ([allows]: units open now). */
    fun facts(
        track: LoadedTrack,
        history: List<AnswerEvent>,
        completed: Set<String>,
        profile: Profile,
        allows: (String) -> Boolean,
    ): TrackFacts {
        val rows =
            UnitPicks.rows(
                units = track.pack.units,
                content = SessionContent.playable(track.content),
                history = history,
                audience = profile.audience,
                lang = profile.lang,
                allows = allows,
                completed = completed,
            )
        val meta = track.pack.meta
        return TrackFacts(
            track = track.track,
            subject = meta.subject,
            level = meta.level,
            language = meta.targetLang,
            unitsDone = rows.count(::unitDone),
            unitsTotal = rows.size,
            unitsOpen = rows.count { !it.locked },
            lastActiveMs = history.mapNotNull { epochMs(it.timestamp) }.maxOrNull(),
        )
    }

    /** Every module with at least one track for this profile, in shelf order ([Subject] order). */
    fun modules(
        tracks: List<TrackFacts>,
        audience: Audience,
        choices: Map<String, ModuleChoice>,
    ): List<ModuleView> = Subject.entries.mapNotNull { module(it, tracks, audience, choices[it.code]) }

    /** Null when the profile has no track at all in [subject] (the module is not shown: no dead cards). */
    fun module(
        subject: Subject,
        tracks: List<TrackFacts>,
        audience: Audience,
        choice: ModuleChoice?,
    ): ModuleView? {
        val mine = tracks.filter { it.subject == subject && (subject != Subject.BAHASA || languageOf(it, audience) != null) }
        if (mine.isEmpty()) return null
        val languages =
            if (subject == Subject.BAHASA) {
                ModuleLanguage.entries.filter { l -> mine.any { languageOf(it, audience) == l } }
            } else {
                emptyList()
            }
        val language = if (subject == Subject.BAHASA) pickLanguage(languages, mine, audience, choice) else null
        val pool = if (language == null) mine else mine.filter { it.language == language.code }
        val byLevel = Level.entries.associateWith { lv -> pool.firstOrNull { it.level == lv } }
        val level = pickLevel(byLevel, pool, choice)
        val current = byLevel.getValue(level) ?: return null
        val next = Level.entries.getOrNull(level.ordinal + 1)
        val suggestion = next?.takeIf { ready(current.unitsDone, current.unitsTotal) && byLevel[it] != null }
        val ladder =
            Level.entries.map { lv ->
                val t = byLevel[lv]
                LevelRung(
                    level = lv,
                    track = t?.track,
                    unitsDone = t?.unitsDone ?: 0,
                    unitsTotal = t?.unitsTotal ?: 0,
                    chosen = lv == level,
                    suggested = lv == suggestion,
                )
            }
        return ModuleView(
            subject = subject,
            languages = languages.map { LanguageOption(it, it == language) },
            language = language,
            ladder = ladder,
            level = level,
            track = current.track,
            suggestion = suggestion,
        )
    }

    /** The choice to store when a language card is tapped: the level stays when the new language has it. */
    fun chooseLanguage(
        view: ModuleView,
        language: ModuleLanguage,
    ): ModuleChoice = ModuleChoice(language = language.code, level = view.level.code)

    /** The choice to store when a level is tapped; null for a «Segera» rung (nothing to start). */
    fun chooseLevel(
        view: ModuleView,
        level: Level,
    ): ModuleChoice? =
        view.ladder
            .firstOrNull { it.level == level && !it.comingSoon }
            ?.let { ModuleChoice(language = view.language?.code, level = level.code) }

    private fun languageOf(
        t: TrackFacts,
        audience: Audience,
    ): ModuleLanguage? = ModuleLanguage.of(t.language)?.takeIf { it.openTo(audience) }

    private fun pickLanguage(
        languages: List<ModuleLanguage>,
        mine: List<TrackFacts>,
        audience: Audience,
        choice: ModuleChoice?,
    ): ModuleLanguage =
        ModuleLanguage.of(choice?.language)?.takeIf { it in languages }
            ?: lastActive(mine)?.let { languageOf(it, audience) }
            ?: languages.first()

    private fun pickLevel(
        byLevel: Map<Level, TrackFacts?>,
        pool: List<TrackFacts>,
        choice: ModuleChoice?,
    ): Level =
        Level.entries.firstOrNull { it.code == choice?.level && byLevel[it] != null }
            ?: lastActive(pool)?.level
            ?: Level.entries.first { byLevel[it] != null }

    private fun lastActive(tracks: List<TrackFacts>): TrackFacts? =
        tracks.filter { it.lastActiveMs != null }.maxByOrNull { it.lastActiveMs ?: 0L }

    private fun epochMs(timestamp: String): Long? =
        try {
            Instant.parse(timestamp).toEpochMilli()
        } catch (e: java.time.format.DateTimeParseException) {
            null
        }
}
