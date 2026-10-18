package id.petalytix.ayailmu.feature.modules

import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.consent.Consent
import id.petalytix.ayailmu.feature.home.fits
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.store.AccessContext
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.TrackAccess
import id.petalytix.ayailmu.feature.store.isFree
import javax.inject.Inject

/**
 * One module's chosen track as Home's card and the module screen show it: what «Mulai» starts, today's progress and
 * what is open. [free] = the module has no pack at all (Nilai): «Gratis», never a store link.
 */
data class ModuleCard(
    val subject: Subject,
    val language: ModuleLanguage?,
    val level: Level,
    val track: String,
    val trackTitle: String,
    /** Questions answered today on this track. */
    val todayAnswered: Int = 0,
    val unitsDone: Int = 0,
    val unitsTotal: Int = 0,
    /** An unfinished session from today exists for this track: «Lanjutkan». */
    val resumable: Boolean = false,
    /** Shown content includes unapproved items (demo build only). */
    val unreviewed: Boolean = false,
    /** Evidence track (Arabic) and this profile has not consented to the current text: consent first. */
    val needsConsent: Boolean = false,
    val openUnits: Int = 0,
    /** The pack that opens the rest of the track; null when everything is open. */
    val lockedBy: Product? = null,
    val free: Boolean = false,
    /** The next level, once >= 80 % of this level's units are done. */
    val suggestion: Level? = null,
)

/** Everything the module screen shows: the model (languages, ladder, choice) and the chosen track. */
data class ModuleDetail(
    val view: ModuleView,
    val card: ModuleCard,
)

/**
 * Builds the modules of one profile from the content, its answers and its finished challenges (the database side
 * of [ModuleModel]); shared by Home and the module screen so both always agree.
 */
class ModuleAssembler
    @Inject
    constructor(
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val challenges: ChallengeRepository,
    ) {
        private class Row(
            val loaded: LoadedTrack,
            val access: TrackAccess,
            val history: List<AnswerEvent>,
            val facts: TrackFacts,
        )

        /** [only]: just that module (the module screen); null = every module (Home). */
        suspend fun modules(
            profile: Profile,
            ctx: AccessContext,
            choices: Map<String, ModuleChoice>,
            today: String,
            only: Subject? = null,
        ): List<ModuleDetail> {
            val done = challenges.forProfile(profile.id).groupBy({ it.track }, { it.unit }).mapValues { it.value.toSet() }
            val rows =
                content
                    .tracks()
                    .filter { it.fits(profile) && (only == null || it.pack.meta.subject == only) }
                    .map { t ->
                        val access = AccessPolicy.forTrack(t, ctx)
                        val history = answers.history(profile.id, t.track)
                        Row(t, access, history, ModuleModel.facts(t, history, done[t.track].orEmpty(), profile, access::allows))
                    }.filter { it.facts.unitsTotal > 0 }
            return ModuleModel.modules(rows.map { it.facts }, profile.audience, choices).mapNotNull { view ->
                val row = rows.firstOrNull { it.loaded.track == view.track } ?: return@mapNotNull null
                ModuleDetail(view, card(view, row, profile, today))
            }
        }

        private suspend fun card(
            view: ModuleView,
            row: Row,
            profile: Profile,
            today: String,
        ): ModuleCard {
            val meta = row.loaded.pack.meta
            val playable = SessionContent.playable(row.loaded.content, row.access::allows)
            val snap = runCatching { answers.resumable(profile.id, playable) }.getOrNull()
            return ModuleCard(
                subject = view.subject,
                language = view.language,
                level = view.level,
                track = row.loaded.track,
                trackTitle = meta.title.resolve(profile.lang),
                todayAnswered = row.history.count { it.localDate == today },
                unitsDone = row.facts.unitsDone,
                unitsTotal = row.facts.unitsTotal,
                resumable = snap != null && SessionContent.canResume(snap, profile.id, today),
                unreviewed = playable.unreviewed,
                needsConsent = Consent.required(meta.mode, profile),
                openUnits = row.facts.unitsOpen,
                lockedBy = if (row.access.locked) row.access.product else null,
                free = meta.subject.isFree,
                suggestion = view.suggestion,
            )
        }
    }
