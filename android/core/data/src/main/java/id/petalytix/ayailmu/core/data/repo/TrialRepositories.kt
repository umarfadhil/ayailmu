package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.SurveyRecord
import id.petalytix.ayailmu.core.data.UnitChallenge
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.SurveyAnswerEntity
import id.petalytix.ayailmu.core.data.db.UnitChallengeEntity
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.IdGenerator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/** Trial questionnaires (P7): stored on the device, exported with the rest (CR-DAT-4), never uploaded. */
class SurveyRepository(
    private val db: AyaDatabase,
    private val clock: Clock,
    private val ids: IdGenerator,
) {
    suspend fun save(
        profileId: String,
        track: String,
        kind: String,
        answers: Map<String, List<String>>,
        appVersion: String,
    ): SurveyRecord {
        val entity =
            SurveyAnswerEntity(
                surveyId = ids.newId("srv"),
                profileId = profileId,
                track = track,
                kind = kind,
                timestamp = clock.now().toString(),
                appVersion = appVersion,
                payload = ContentJson.json.encodeToString(ANSWERS, answers),
            )
        db.surveys().insert(entity)
        return entity.toModel()
    }

    fun observe(profileId: String): Flow<List<SurveyRecord>> = db.surveys().observeFor(profileId).map { list -> list.map { it.toModel() } }

    suspend fun forProfile(profileId: String): List<SurveyRecord> = db.surveys().forProfile(profileId).map { it.toModel() }

    suspend fun all(): List<SurveyRecord> = db.surveys().all().map { it.toModel() }

    companion object {
        val ANSWERS = MapSerializer(String.serializer(), ListSerializer(String.serializer()))
    }
}

/** Finished unit challenges (P6): the source of truth for earned stickers. */
class ChallengeRepository(
    private val db: AyaDatabase,
    private val clock: Clock,
    private val ids: IdGenerator,
) {
    suspend fun complete(
        profileId: String,
        track: String,
        unit: String,
    ): UnitChallenge {
        val entity =
            UnitChallengeEntity(
                challengeId = ids.newId("chl"),
                profileId = profileId,
                track = track,
                unit = unit,
                completedAt = clock.now().toString(),
            )
        db.challenges().insert(entity)
        return entity.toModel()
    }

    fun observe(profileId: String): Flow<List<UnitChallenge>> = db.challenges().observeFor(profileId).map { list -> list.map { it.toModel() } }

    suspend fun forProfile(profileId: String): List<UnitChallenge> = db.challenges().forProfile(profileId).map { it.toModel() }

    suspend fun all(): List<UnitChallenge> = db.challenges().all().map { it.toModel() }
}

fun SurveyAnswerEntity.toModel(): SurveyRecord =
    SurveyRecord(
        surveyId = surveyId,
        profileId = profileId,
        track = track,
        kind = kind,
        timestamp = timestamp,
        appVersion = appVersion,
        answers = runCatching { ContentJson.json.decodeFromString(SurveyRepository.ANSWERS, payload) }.getOrDefault(emptyMap()),
    )

fun UnitChallengeEntity.toModel(): UnitChallenge = UnitChallenge(challengeId, profileId, track, unit, completedAt)
