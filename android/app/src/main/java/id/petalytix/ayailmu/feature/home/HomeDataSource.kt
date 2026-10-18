package id.petalytix.ayailmu.feature.home

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.AppConfigRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.repo.SurveyRepository
import id.petalytix.ayailmu.core.data.settings.DailyPuzzleStore
import id.petalytix.ayailmu.core.data.settings.DevOptionsStore
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.data.settings.ProfileChoiceStore
import id.petalytix.ayailmu.core.data.settings.PuzzleMark
import id.petalytix.ayailmu.core.data.settings.TrialStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.modules.ModuleAssembler
import id.petalytix.ayailmu.feature.modules.ModuleCard
import id.petalytix.ayailmu.feature.puzzle.DailyPuzzle
import id.petalytix.ayailmu.feature.store.AccessContext
import id.petalytix.ayailmu.feature.store.AccessSource
import id.petalytix.ayailmu.feature.trial.SurveyKind
import id.petalytix.ayailmu.feature.trial.SurveyRules
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import java.time.LocalDate
import javax.inject.Inject

/** Developer-check numbers shown on Home in the demo build: proves content and storage work on device. */
data class DevCheck(
    val tracks: Int = 0,
    val items: Int = 0,
    val problems: Int = 0,
    val profiles: Int = 0,
    val answers: Int = 0,
    val activeLabel: String? = null,
    val activeLang: Lang? = null,
    val loadError: String? = null,
    /** Demo build: "simulate the free tier" (locks and store as in prod) instead of every unit open. */
    val freeTier: Boolean = false,
)

/** Home's daily puzzle (P6): one a day per profile, from any subject on the shelf. */
data class PuzzleCard(
    val track: String,
    val itemId: String,
    /** Title of the subject the puzzle comes from. */
    val subjectTitle: String,
    /** Answered today; a new one comes tomorrow. */
    val done: Boolean,
)

/** P7: a trial survey is due for this profile (day 7 or end of trial); "Nanti saja" hides it until tomorrow. */
data class SurveyCard(
    val track: String,
    val kind: SurveyKind,
)

/**
 * Home (follow-up 12): one card per module ([modules], MODULES_LEVELS_STORIES.md section 1) instead of one per track.
 * [avatars]: profile id to its picture (every profile, for the switcher).
 */
data class HomeData(
    val profile: Profile?,
    val profiles: List<Profile>,
    val modules: List<ModuleCard>,
    val loadError: Boolean = false,
    val puzzle: PuzzleCard? = null,
    val survey: SurveyCard? = null,
    val avatars: Map<String, String> = emptyMap(),
)

/** What Home needs from the data layer; an interface so the ViewModel is testable with a fake. */
interface HomeDataSource {
    fun home(): Flow<HomeData>

    fun devCheck(): Flow<DevCheck>

    suspend fun switchProfile(id: String)

    suspend fun createTestProfile(
        label: String,
        lang: Lang,
    )

    suspend fun setFreeTier(on: Boolean) {}

    /** "Nanti saja" on the survey card: not again today for the active profile. */
    suspend fun snoozeSurvey() {}
}

/** The tracks a profile sees on its shelf: its language and its audience (kids or adults). */
fun LoadedTrack.fits(profile: Profile): Boolean = profile.lang in pack.meta.instructionLangs && profile.audience in pack.meta.audiences

class DefaultHomeDataSource
    @Inject
    constructor(
        private val content: ContentRepository,
        private val profiles: ProfileRepository,
        private val answers: AnswerRepository,
        private val clock: Clock,
        private val access: AccessSource,
        private val puzzles: DailyPuzzleStore,
        private val dev: DevOptionsStore,
        private val config: AppConfigRepository,
        private val surveys: SurveyRepository,
        private val trialStore: TrialStore,
        private val choices: ProfileChoiceStore,
        private val assembler: ModuleAssembler,
    ) : HomeDataSource {
        private class Inputs(
            val active: Profile?,
            val all: List<Profile>,
            val ctx: AccessContext,
            val marks: Map<String, PuzzleMark>,
        )

        /**
         * Re-evaluated whenever the active profile, the profile list, the number of saved answers, what is
         * unlocked (a purchase, a refund), today's puzzle mark, a module choice or an avatar changes.
         */
        override fun home(): Flow<HomeData> =
            combine(
                profiles.observeActive(),
                profiles.observeProfiles(),
                answers.observeCount(),
                access.observe(),
                puzzles.marks,
            ) { active, all, _, ctx, marks -> Inputs(active, all, ctx, marks) }
                .combine(choices.choices) { inputs, chosen -> build(inputs, chosen) }
                .combine(choices.avatars) { home, avatars -> home.copy(avatars = Avatars.resolve(home.profiles, avatars)) }
                .combine(trialStore.surveySnoozed) { home, snoozed ->
                    val p = home.profile
                    if (p == null) home else home.copy(survey = runCatching { surveyCard(p, snoozed[p.id] == today()) }.getOrNull())
                }

        private suspend fun build(
            inputs: Inputs,
            chosen: Map<String, Map<String, ModuleChoice>>,
        ): HomeData {
            val active = inputs.active ?: return HomeData(profile = null, profiles = inputs.all, modules = emptyList())
            val loaded = runCatching { content.tracks() }
            val mine = loaded.getOrDefault(emptyList()).filter { it.fits(active) }
            val modules =
                if (loaded.isFailure) {
                    emptyList()
                } else {
                    runCatching { assembler.modules(active, inputs.ctx, chosen[active.id].orEmpty(), today()) }.getOrDefault(emptyList())
                }
            return HomeData(
                profile = active,
                profiles = inputs.all,
                modules = modules.map { it.card },
                loadError = loaded.isFailure,
                puzzle = puzzleCard(mine, active, inputs.marks[active.id]),
            )
        }

        /** The trial survey due today (P7), from `trial` in app_config.json; null when none, or config is invalid. */
        private suspend fun surveyCard(
            profile: Profile,
            snoozedToday: Boolean,
        ): SurveyCard? {
            val trial = config.trial()
            val done = surveys.forProfile(profile.id).filter { it.track == trial.track }.mapNotNull { SurveyKind.of(it.kind) }.toSet()
            val kind =
                SurveyRules.forProfile(
                    profile = profile,
                    trial = trial,
                    history = answers.history(profile.id, trial.track),
                    done = done,
                    today = LocalDate.parse(today()),
                    snoozedToday = snoozedToday,
                ) ?: return null
            return SurveyCard(trial.track, kind)
        }

        override suspend fun snoozeSurvey() {
            val p = profiles.activeProfile() ?: return
            trialStore.snoozeSurvey(p.id, today())
        }

        private fun today(): String = Dates.localDate(clock.now().toEpochMilli(), clock.zone)

        private fun puzzleCard(
            mine: List<LoadedTrack>,
            profile: Profile,
            mark: PuzzleMark?,
        ): PuzzleCard? {
            val today = today()
            val pick = DailyPuzzle.pick(DailyPuzzle.candidates(mine, profile), today, profile.id) ?: return null
            val track = mine.firstOrNull { it.track == pick.track } ?: return null
            return PuzzleCard(
                track = pick.track,
                itemId = pick.item.itemId,
                subjectTitle = track.pack.meta.title.resolve(profile.lang),
                done = mark != null && mark.date == today,
            )
        }

        private fun contentStats(): Flow<DevCheck> =
            flow {
                emit(
                    runCatching {
                        val tracks = content.tracks()
                        DevCheck(tracks = tracks.size, items = tracks.sumOf { it.content.items.size }, problems = tracks.sumOf { it.problems.size })
                    }.getOrElse { DevCheck(loadError = it.message ?: it.toString()) },
                )
            }

        override fun devCheck(): Flow<DevCheck> =
            combine(contentStats(), profiles.observeProfiles(), answers.observeCount(), profiles.observeActive(), dev.freeTier) { c, all, count, active, freeTier ->
                c.copy(profiles = all.size, answers = count, activeLabel = active?.label, activeLang = active?.lang, freeTier = freeTier)
            }

        override suspend fun switchProfile(id: String) = profiles.setActive(id)

        override suspend fun createTestProfile(
            label: String,
            lang: Lang,
        ) {
            profiles.create(label = label, kind = ProfileKind.ADULT, lang = lang)
        }

        override suspend fun setFreeTier(on: Boolean) = dev.setFreeTier(on)
    }
