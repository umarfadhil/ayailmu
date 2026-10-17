package id.petalytix.ayailmu.feature.home

import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.consent.Consent
import id.petalytix.ayailmu.feature.session.SessionContent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
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
)

/** One subject on the shelf, already filtered for the active profile's language and audience. */
data class TrackCard(
    val track: String,
    val title: String,
    val items: Int,
    /** An unfinished session from today exists for this profile. */
    val resumable: Boolean,
    /** Shown content includes unapproved items (demo build only). */
    val unreviewed: Boolean,
    /** Evidence track and this profile has not consented to the current text yet: open the consent screen first. */
    val needsConsent: Boolean = false,
)

data class HomeData(
    val profile: Profile?,
    val profiles: List<Profile>,
    val tracks: List<TrackCard>,
    val loadError: Boolean = false,
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
}

class DefaultHomeDataSource
    @Inject
    constructor(
        private val content: ContentRepository,
        private val profiles: ProfileRepository,
        private val answers: AnswerRepository,
        private val clock: Clock,
    ) : HomeDataSource {
        /** Re-evaluated whenever the active profile, the profile list or the number of saved answers changes. */
        override fun home(): Flow<HomeData> =
            combine(profiles.observeActive(), profiles.observeProfiles(), answers.observeCount()) { active, all, _ ->
                val loaded = runCatching { content.tracks() }
                val tracks = if (active == null) emptyList() else loaded.getOrDefault(emptyList()).mapNotNull { card(it, active) }
                HomeData(profile = active, profiles = all, tracks = tracks, loadError = loaded.isFailure)
            }

        private suspend fun card(
            t: LoadedTrack,
            profile: Profile,
        ): TrackCard? {
            val meta = t.pack.meta
            if (profile.lang !in meta.instructionLangs || profile.audience !in meta.audiences) return null
            val playable = SessionContent.playable(t.content)
            val count = playable.items.count { it.audience == null || it.audience == profile.audience }
            if (count == 0) return null
            val today = Dates.localDate(clock.now().toEpochMilli(), clock.zone)
            val snap = runCatching { answers.resumable(profile.id, playable) }.getOrNull()
            return TrackCard(
                track = t.track,
                title = meta.title.resolve(profile.lang),
                items = count,
                resumable = snap != null && SessionContent.canResume(snap, profile.id, today),
                unreviewed = playable.unreviewed,
                needsConsent = Consent.required(meta.mode, profile),
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
            combine(contentStats(), profiles.observeProfiles(), answers.observeCount(), profiles.observeActive()) { c, all, count, active ->
                c.copy(profiles = all.size, answers = count, activeLabel = active?.label, activeLang = active?.lang)
            }

        override suspend fun switchProfile(id: String) = profiles.setActive(id)

        override suspend fun createTestProfile(
            label: String,
            lang: Lang,
        ) {
            profiles.create(label = label, kind = ProfileKind.ADULT, lang = lang)
        }
    }
