package id.petalytix.ayailmu.core.data.repo

import androidx.room.withTransaction
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.Mappers
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.db.OwnerBindingEntity
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.IdGenerator
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Learner profiles (CR-DAT-2, CR-DAT-5, CR-I18N-2). Rules enforced here, not in the UI:
 * an Anak (child) profile can only be created by an existing Adult profile; the audience follows the kind.
 */
class ProfileRepository(
    private val db: AyaDatabase,
    private val active: ActiveProfileStore,
    private val clock: Clock,
    private val ids: IdGenerator,
    private val visibility: ProfileVisibility = AllowAllProfiles,
) {
    fun observeProfiles(): Flow<List<Profile>> = combine(db.profiles().observeAll(), visibility.changes) { rows, _ -> rows }
        .map { rows -> rows.filter { visibility.allows(it.id) }.map { it.toModel() } }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeActive(): Flow<Profile?> =
        combine(active.activeId, visibility.changes) { id, _ -> id }.flatMapLatest { id ->
            if (id == null || !visibility.allows(id)) flowOf(null) else db.profiles().observe(id).map { entity -> entity?.takeIf { visibility.allows(it.id) }?.toModel() }
        }

    suspend fun all(): List<Profile> = db.profiles().all().filter { visibility.allows(it.id) }.map { it.toModel() }

    suspend fun activeProfile(): Profile? = active.activeId.first()?.takeIf(visibility::allows)?.let { db.profiles().get(it)?.takeIf { row -> visibility.allows(row.id) }?.toModel() }

    private fun requireVisible(profileId: String) = require(visibility.allows(profileId)) { "Profile is not available in this owner context" }

    suspend fun create(
        label: String,
        kind: ProfileKind,
        lang: Lang,
        birthYear: Int? = null,
        createdBy: String? = null,
        makeActive: Boolean = true,
    ): Profile {
        require(label.isNotBlank()) { "label must not be blank" }
        if (kind == ProfileKind.ANAK) {
            requireNotNull(createdBy) { "An Anak profile needs a visible Adult creator" }
            requireVisible(createdBy)
            val creator = db.profiles().get(createdBy)
            require(creator != null && creator.kind == ProfileKind.ADULT.name) {
                "An Anak profile can only be created from an existing Adult profile (CR-DAT-5)"
            }
        }
        val entity =
            ProfileEntity(
                id = ids.newId("lrn"),
                label = label.trim(),
                kind = kind.name,
                createdBy = createdBy,
                birthYear = birthYear,
                audience = (if (kind == ProfileKind.ANAK) Audience.KIDS else Audience.ADULTS).name,
                instructionLang = lang.tag,
                createdAt = clock.now().toEpochMilli(),
                sessionMinutes = null,
                arabicScale = 1.0f,
                screensSeen = "[]",
                consentVersion = null,
                consentAt = null,
            )
        db.withTransaction {
            db.profiles().upsert(entity)
            if (kind == ProfileKind.ANAK) {
                visibility.ownership(requireNotNull(createdBy))?.let { owned ->
                    db.ownerBindings().upsert(OwnerBindingEntity(entity.id, owned.ownerId, owned.environmentId))
                }
            }
        }
        if (makeActive || active.activeId.first() == null) active.setActive(entity.id)
        return entity.toModel()
    }

    suspend fun setActive(id: String) {
        require(visibility.allows(id) && db.profiles().get(id) != null) { "unknown or unavailable profile" }
        active.setActive(id)
    }

    suspend fun setLanguage(
        id: String,
        lang: Lang,
    ) {
        requireVisible(id)
        db.profiles().setLang(id, lang.tag)
    }

    /** Daily session length; null = each track's default (CR-HAB-1). */
    suspend fun setSessionMinutes(
        id: String,
        minutes: Int?,
    ) {
        requireVisible(id)
        require(minutes == null || minutes > 0) { "session minutes must be positive" }
        db.profiles().setSessionMinutes(id, minutes)
    }

    /** Arabic text size factor, clamped so Arabic never drops below 22 sp (CR-ENG-6). */
    suspend fun setArabicScale(
        id: String,
        scale: Float,
    ) {
        requireVisible(id)
        db.profiles().setArabicScale(id, scale.coerceIn(ARABIC_SCALE_MIN, ARABIC_SCALE_MAX))
    }

    /** Records the consent the learner just gave (Trial_App_Spec §11): which text version, and when. */
    suspend fun recordConsent(
        id: String,
        version: String,
    ) {
        requireVisible(id)
        db.profiles().setConsent(id, version, clock.now().toEpochMilli())
    }

    /** Withdraws consent; the evidence track asks again before the next session. */
    suspend fun withdrawConsent(id: String) {
        requireVisible(id)
        db.profiles().setConsent(id, null, null)
    }

    /** Removes the profile and everything recorded for it. */
    suspend fun delete(id: String) {
        requireVisible(id)
        val ownership = visibility.ownership(id)
        db.withTransaction {
            if (ownership != null) {
                db.profiles().all().filter { it.createdBy == id }.forEach { child ->
                    db.ownerBindings().upsert(OwnerBindingEntity(child.id, ownership.ownerId, ownership.environmentId))
                }
            }
            db.answers().deleteForProfile(id)
            db.snapshots().deleteForProfile(id)
            db.reports().deleteForProfile(id)
            db.surveys().deleteForProfile(id)
            db.challenges().deleteForProfile(id)
            db.profiles().delete(id)
            db.ownerBindings().delete(id)
        }
        if (active.activeId.first() == id) active.setActive(db.profiles().all().firstOrNull { visibility.allows(it.id) }?.id)
    }
}

const val ARABIC_SCALE_MIN = 0.8f
const val ARABIC_SCALE_MAX = 2.0f

fun ProfileEntity.toModel() =
    Profile(
        id = id,
        label = label,
        kind = ProfileKind.valueOf(kind),
        createdBy = createdBy,
        birthYear = birthYear,
        audience = Audience.valueOf(audience),
        lang = Lang.fromTag(instructionLang),
        createdAtMs = createdAt,
        sessionMinutes = sessionMinutes,
        arabicScale = arabicScale,
        screensSeen = Mappers.decodeIds(screensSeen),
        consentVersion = consentVersion,
    )
