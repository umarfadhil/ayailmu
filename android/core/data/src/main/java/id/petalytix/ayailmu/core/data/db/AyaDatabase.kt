package id.petalytix.ayailmu.core.data.db

import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The only durable store for learner data (CR-DAT-1). Schemas exported to core/data/schemas.
 * Destructive migration is forbidden: every version bump ships a Migration and a test.
 *
 * v2 (2026-10-17, P7/P6): adds `survey_answers` (trial background and surveys) and `unit_challenges` (finished
 * unit challenges). Both are new tables only, so Room's generated auto-migration is enough; `MigrationTest`
 * opens a real v1 file and checks that v2 keeps its rows.
 */
@Database(
    entities = [
        ProfileEntity::class,
        AnswerEventEntity::class,
        SessionSnapshotEntity::class,
        ItemReportEntity::class,
        SurveyAnswerEntity::class,
        UnitChallengeEntity::class,
    ],
    version = 2,
    exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2)],
)
abstract class AyaDatabase : RoomDatabase() {
    abstract fun profiles(): ProfileDao

    abstract fun answers(): AnswerDao

    abstract fun snapshots(): SnapshotDao

    abstract fun reports(): ReportDao

    abstract fun surveys(): SurveyDao

    abstract fun challenges(): ChallengeDao

    companion object {
        const val NAME = "ayailmu.db"
    }
}
