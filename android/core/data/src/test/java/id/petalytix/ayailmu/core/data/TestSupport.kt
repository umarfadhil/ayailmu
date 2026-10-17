package id.petalytix.ayailmu.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.engine.FixedClock
import java.time.Instant
import java.time.ZoneId

/** Shared helpers for the :core:data tests (Robolectric gives Room a real SQLite on the JVM). */
object TestSupport {
    val ZONE: ZoneId = ZoneId.of("Asia/Jakarta")

    fun clock(at: String = "2026-10-15T02:00:00Z") = FixedClock(Instant.parse(at), ZONE)

    fun inMemoryDb(): AyaDatabase =
        Room
            .inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java)
            .allowMainThreadQueries()
            .build()

    /** Reads bundled assets from the test classpath (content/src/main/assets is added as a test resource dir). */
    val classpathAssets =
        AssetSource { path ->
            val stream = TestSupport::class.java.classLoader!!.getResourceAsStream(path)
            requireNotNull(stream) { "missing test asset $path" }
            stream.use { it.readBytes().decodeToString() }
        }
}
