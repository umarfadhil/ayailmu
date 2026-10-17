package id.petalytix.ayailmu.core.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The only durable store for learner data (CR-DAT-1). Version 1, schema exported to core/data/schemas.
 * Destructive migration is forbidden: every version bump ships a Migration and a MigrationTestHelper test.
 */
@Database(
    entities = [ProfileEntity::class, AnswerEventEntity::class, SessionSnapshotEntity::class, ItemReportEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AyaDatabase : RoomDatabase() {
    abstract fun profiles(): ProfileDao

    abstract fun answers(): AnswerDao

    abstract fun snapshots(): SnapshotDao

    abstract fun reports(): ReportDao

    companion object {
        const val NAME = "ayailmu.db"
    }
}
