package id.petalytix.ayailmu.core.data

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.OwnerBindingEntity
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.SurveyRepository
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * CR-DAT-1: a real v1 database file (built from the exported v1 schema, exactly as Room created it) opens as v2
 * through the auto-migration and keeps its rows; the two new tables work afterwards. Written by hand instead of
 * MigrationTestHelper so it does not depend on the schemas being packaged as Robolectric assets.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val name = "migration-test.db"

    @After
    fun tearDown() {
        context.deleteDatabase(name)
    }

    /** The exported schema; Gradle runs unit tests from the module directory. */
    private fun schema(version: Int): JsonObject {
        val path = "schemas/id.petalytix.ayailmu.core.data.db.AyaDatabase/$version.json"
        val file = listOf(File(path), File("core/data/$path")).firstOrNull { it.exists() } ?: error("missing exported schema $path")
        return Json.parseToJsonElement(file.readText()).jsonObject.getValue("database").jsonObject
    }

    private fun createV1() {
        val v1 = schema(1)
        val callback =
            object : SupportSQLiteOpenHelper.Callback(1) {
                override fun onCreate(db: SupportSQLiteDatabase) {
                    v1.getValue("entities").jsonArray.forEach { e ->
                        val entity = e.jsonObject
                        val table = entity.getValue("tableName").jsonPrimitive.content
                        db.execSQL(entity.getValue("createSql").jsonPrimitive.content.replace(TABLE, table))
                        entity["indices"]?.jsonArray?.forEach { i ->
                            db.execSQL(i.jsonObject.getValue("createSql").jsonPrimitive.content.replace(TABLE, table))
                        }
                    }
                    v1.getValue("setupQueries").jsonArray.forEach { db.execSQL(it.jsonPrimitive.content) }
                }

                override fun onUpgrade(
                    db: SupportSQLiteDatabase,
                    oldVersion: Int,
                    newVersion: Int,
                ) = Unit
            }
        val helper = FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(context).name(name).callback(callback).build())
        helper.writableDatabase.execSQL(
            "INSERT INTO item_reports (report_id, profile_id, item_id, content_version, timestamp, reason, text) " +
                "VALUES ('rep-1', 'lrn-1', 'DEMO-M01', 'demo-synthetic-0.1', '2026-10-15T02:00:00Z', 'typo', 'harakat')",
        )
        helper.close()
    }

    @Test
    fun `a version 1 database opens as version 3 with its rows and the new tables`() =
        runTest {
            createV1()
            val db = Room.databaseBuilder(context, AyaDatabase::class.java, name).allowMainThreadQueries().build()
            try {
                assertEquals(listOf("rep-1"), db.reports().all().map { it.reportId })
                assertEquals(3, db.openHelper.readableDatabase.version)
                val clock = TestSupport.clock()
                val ids = CountingIdGenerator()
                SurveyRepository(db, clock, ids).save("lrn-1", "arab", "background", mapOf("e_b4" to listOf("10")), "0.6.0")
                ChallengeRepository(db, clock, ids).complete("lrn-1", "mat", "01")
                assertEquals(1, db.surveys().all().size)
                assertTrue(db.challenges().forProfile("lrn-1").single().unit == "01")
                db.ownerBindings().upsert(OwnerBindingEntity("lrn-1", "owner-fixture", "environment-fixture"))
                assertEquals("owner-fixture", db.ownerBindings().all().single().ownerId)
            } finally {
                db.close()
            }
        }

    private companion object {
        const val TABLE = "\${TABLE_NAME}"
    }
}
