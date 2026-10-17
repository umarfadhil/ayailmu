package id.petalytix.ayailmu.core.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ProfileDao {
    @Query("SELECT * FROM profiles ORDER BY created_at")
    fun observeAll(): Flow<List<ProfileEntity>>

    @Query("SELECT * FROM profiles ORDER BY created_at")
    suspend fun all(): List<ProfileEntity>

    @Query("SELECT * FROM profiles WHERE id = :id")
    suspend fun get(id: String): ProfileEntity?

    @Query("SELECT * FROM profiles WHERE id = :id")
    fun observe(id: String): Flow<ProfileEntity?>

    @Upsert
    suspend fun upsert(profile: ProfileEntity)

    @Query("UPDATE profiles SET screens_seen = :json WHERE id = :id")
    suspend fun setScreensSeen(
        id: String,
        json: String,
    )

    @Query("UPDATE profiles SET instruction_lang = :lang WHERE id = :id")
    suspend fun setLang(
        id: String,
        lang: String,
    )

    @Query("UPDATE profiles SET session_minutes = :minutes WHERE id = :id")
    suspend fun setSessionMinutes(
        id: String,
        minutes: Int?,
    )

    @Query("UPDATE profiles SET arabic_scale = :scale WHERE id = :id")
    suspend fun setArabicScale(
        id: String,
        scale: Float,
    )

    @Query("UPDATE profiles SET consent_version = :version, consent_at = :at WHERE id = :id")
    suspend fun setConsent(
        id: String,
        version: String?,
        at: Long?,
    )

    @Query("DELETE FROM profiles WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface AnswerDao {
    /** Idempotent by answer_id: a retried write never duplicates an answer (prototype parity). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: AnswerEventEntity): Long

    @Query("SELECT * FROM answer_events WHERE profile_id = :profileId AND track = :track ORDER BY local_date, timestamp")
    suspend fun history(
        profileId: String,
        track: String,
    ): List<AnswerEventEntity>

    @Query("SELECT * FROM answer_events ORDER BY profile_id, local_date, timestamp")
    suspend fun all(): List<AnswerEventEntity>

    @Query("SELECT COUNT(*) FROM answer_events")
    fun observeCount(): Flow<Int>

    @Query("DELETE FROM answer_events WHERE profile_id = :profileId")
    suspend fun deleteForProfile(profileId: String)
}

@Dao
interface SnapshotDao {
    @Upsert
    suspend fun upsert(snapshot: SessionSnapshotEntity)

    @Query("SELECT * FROM session_snapshots WHERE profile_id = :profileId AND track = :track")
    suspend fun get(
        profileId: String,
        track: String,
    ): SessionSnapshotEntity?

    @Query("DELETE FROM session_snapshots WHERE profile_id = :profileId AND track = :track")
    suspend fun delete(
        profileId: String,
        track: String,
    )

    @Query("DELETE FROM session_snapshots WHERE profile_id = :profileId")
    suspend fun deleteForProfile(profileId: String)
}

@Dao
interface ReportDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(report: ItemReportEntity)

    @Query("SELECT * FROM item_reports ORDER BY timestamp")
    suspend fun all(): List<ItemReportEntity>

    @Query("DELETE FROM item_reports WHERE profile_id = :profileId")
    suspend fun deleteForProfile(profileId: String)
}
