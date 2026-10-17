package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.data.ItemReport
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.ItemReportEntity
import id.petalytix.ayailmu.core.data.db.Mappers
import id.petalytix.ayailmu.core.data.db.RoomSessionStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.IdGenerator
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.SessionStore
import id.petalytix.ayailmu.core.model.AnswerEvent
import kotlinx.coroutines.flow.Flow

/** Answer events, session snapshots and item reports (CR-ARC-4: events are the source of truth). */
class AnswerRepository(
    private val db: AyaDatabase,
    private val clock: Clock,
    private val ids: IdGenerator,
) {
    fun storeFor(profileId: String): SessionStore = RoomSessionStore(db, profileId, clock)

    suspend fun history(
        profileId: String,
        track: String,
    ): List<AnswerEvent> = db.answers().history(profileId, track).map(Mappers::event)

    suspend fun allEvents(): List<AnswerEvent> = db.answers().all().map(Mappers::event)

    fun observeCount(): Flow<Int> = db.answers().observeCount()

    /** The unfinished session for this profile and track, or null when it no longer fits the content. */
    suspend fun resumable(
        profileId: String,
        content: GatedContent,
    ): SessionState? = Session.restore(db.snapshots().get(profileId, content.track)?.payload, content)

    suspend fun clearSnapshot(
        profileId: String,
        track: String,
    ) = db.snapshots().delete(profileId, track)

    suspend fun addReport(
        profileId: String,
        itemId: String,
        contentVersion: String,
        reason: String,
        text: String,
    ): ItemReport {
        val entity =
            ItemReportEntity(
                reportId = ids.newId("rep"),
                profileId = profileId,
                itemId = itemId,
                contentVersion = contentVersion,
                timestamp = clock.now().toString(),
                reason = reason,
                text = text,
            )
        db.reports().insert(entity)
        return entity.toModel()
    }

    suspend fun allReports(): List<ItemReport> = db.reports().all().map { it.toModel() }
}

fun ItemReportEntity.toModel() = ItemReport(reportId, profileId, itemId, contentVersion, timestamp, reason, text)
