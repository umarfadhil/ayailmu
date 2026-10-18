package id.petalytix.ayailmu.feature.store

import id.petalytix.ayailmu.core.billing.EntitlementRepository
import id.petalytix.ayailmu.core.billing.Entitlements
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.repo.AppConfigRepository
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.data.settings.DevOptionsStore
import id.petalytix.ayailmu.core.data.settings.TrialStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Dates
import id.petalytix.ayailmu.core.model.Subject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import java.time.LocalDate
import javax.inject.Inject

/**
 * Which units of one track this learner may open (MONETIZATION_SCHEME "Free tier"): the catalog's free units
 * for everyone; every unit with the subject pack or all-access. A track without free units is fully open.
 */
data class TrackAccess(
    val product: Product?,
    val freeUnits: Set<String>,
    val fullyOpen: Boolean,
) {
    fun allows(unit: String): Boolean = fullyOpen || unit in freeUnits

    val locked: Boolean get() = !fullyOpen
}

/** What decides access right now: Play entitlements, a closed-test tester code, and the demo build's switch. */
data class AccessContext(
    val entitlements: Entitlements = Entitlements(),
    /**
     * Every unit open: a valid tester code was entered (P7, any build), or the developer demo without
     * "simulate free tier" (Home developer card).
     */
    val unlockAll: Boolean = false,
)

object AccessPolicy {
    fun forTrack(
        subject: Subject,
        freeUnits: List<String>,
        ctx: AccessContext,
    ): TrackAccess {
        val product = Product.forSubject(subject)
        // product == null is a free module (Nilai, follow-up 12): every unit open, whatever the catalog's free_units say.
        val open = ctx.unlockAll || freeUnits.isEmpty() || product == null || ctx.entitlements.unlocks(product)
        return TrackAccess(product, freeUnits.toSet(), open)
    }

    fun forTrack(
        track: LoadedTrack,
        ctx: AccessContext,
    ): TrackAccess = forTrack(track.pack.meta.subject, track.freeUnits, ctx)
}

/** The live access context; an interface so Home, the session and progress are tested without Play. */
interface AccessSource {
    fun observe(): Flow<AccessContext>

    suspend fun current(): AccessContext = observe().first()
}

class DefaultAccessSource
    @Inject
    constructor(
        private val entitlements: EntitlementRepository,
        private val dev: DevOptionsStore,
        private val build: AppBuildInfo,
        private val trial: TrialStore,
        private val config: AppConfigRepository,
        private val clock: Clock,
    ) : AccessSource {
        // Waits for the entitlement cache first: before it loads, "nothing owned" would be a false answer.
        override fun observe(): Flow<AccessContext> =
            flow {
                entitlements.awaitLoaded()
                emitAll(
                    combine(entitlements.entitlements, dev.freeTier, trial.testerUnlock) { e, freeTier, tester ->
                        // The stored switch counts only while this build still honours tester codes (tester_until).
                        val testerOn = tester && testerCodesOpen()
                        AccessContext(entitlements = e, unlockAll = Access.unlockAll(testerOn, build.developerDemo, freeTier))
                    },
                )
            }

        private suspend fun testerCodesOpen(): Boolean =
            try {
                config.trial().testerOpen(LocalDate.parse(Dates.localDate(clock.now().toEpochMilli(), clock.zone)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                false // a broken app_config.json opens nothing
            }
    }

object Access {
    /** A tester code opens everything in every build; the demo build does unless the free tier is simulated. */
    fun unlockAll(
        tester: Boolean,
        developerDemo: Boolean,
        simulateFreeTier: Boolean,
    ): Boolean = tester || (developerDemo && !simulateFreeTier)
}

/** Subject cover in the art catalog (docs/ART_CATALOG.md; Nilai and Sejarah: MODULES_LEVELS_STORIES.md section 6.1). */
fun Subject.coverKey(): String =
    when (this) {
        Subject.BAHASA -> "cover_bahasa"
        Subject.MATEMATIKA -> "cover_matematika"
        Subject.SAINS -> "cover_sains"
        Subject.SOSIAL_SENI -> "cover_sosial_seni"
        Subject.NILAI -> "cover_nilai"
        Subject.SEJARAH -> "cover_sejarah"
    }

/** True for a module that has no product and so is free for everyone (Nilai). */
val Subject.isFree: Boolean get() = Product.forSubject(this) == null

/** Everything open (tests, previews). */
object OpenAccess : AccessSource {
    override fun observe(): Flow<AccessContext> = flowOf(AccessContext(unlockAll = true))
}
