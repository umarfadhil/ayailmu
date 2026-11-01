package id.petalytix.ayailmu.core.data.db

import androidx.room.withTransaction
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.SessionStore
import id.petalytix.ayailmu.core.model.AnswerEvent
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

/**
 * Room-backed SessionStore for one profile (the engine's storage contract). `recordAnswer` writes the answer
 * event and the session snapshot in one transaction, so the UI never sees a state whose answer was not saved.
 */
class RoomSessionStore(
    private val db: AyaDatabase,
    private val profileId: String,
    private val clock: Clock,
    private val isVisible: () -> Boolean = { true },
) : SessionStore {
    private fun requireVisible() = require(isVisible()) { "Profile is not available in this owner context" }
    override suspend fun recordAnswer(
        event: AnswerEvent,
        snapshot: SessionState,
    ) {
        requireVisible()
        db.withTransaction {
            requireVisible()
            db.answers().insert(event.toEntity(profileId))
            db.snapshots().upsert(snapshot.toEntity(profileId, clock.now().toEpochMilli()))
        }
    }

    override suspend fun saveSnapshot(snapshot: SessionState) {
        requireVisible()
        db.snapshots().upsert(snapshot.toEntity(profileId, clock.now().toEpochMilli()))
    }

    override suspend fun saveScreensSeen(screenIds: List<String>) {
        requireVisible()
        db.profiles().setScreensSeen(profileId, Mappers.encodeIds(screenIds))
    }
}

/** Conversions between engine models and Room rows. JSON always via ContentJson (one configuration). */
object Mappers {
    private val idList = ListSerializer(String.serializer())

    fun encodeIds(ids: List<String>): String = ContentJson.json.encodeToString(idList, ids)

    fun decodeIds(json: String): List<String> =
        if (json.isBlank()) emptyList() else ContentJson.json.decodeFromString(idList, json)

    fun event(entity: AnswerEventEntity): AnswerEvent = ContentJson.json.decodeFromString(AnswerEvent.serializer(), entity.payload)
}

fun AnswerEvent.toEntity(profileId: String) =
    AnswerEventEntity(
        answerId = answerId,
        profileId = profileId,
        track = track,
        itemId = itemId,
        localDate = localDate,
        timestamp = timestamp,
        outcome = outcome.name,
        freshEvidence = freshEvidence,
        payload = ContentJson.json.encodeToString(AnswerEvent.serializer(), this),
    )

fun SessionState.toEntity(
    profileId: String,
    nowMs: Long,
) = SessionSnapshotEntity(
    profileId = profileId,
    track = track,
    payload = Session.encode(this),
    updatedAt = nowMs,
)
