package id.petalytix.ayailmu

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.repo.AndroidAssetSource
import id.petalytix.ayailmu.core.data.repo.ContentCatalog
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.sync.PackProof
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ReviewedProdContentTest {
    @Test fun ordinaryApprovedOnlyLoaderHasTheReviewedPlayableTrack() = runBlocking {
        assertFalse(BuildConfig.DEVELOPER_DEMO)
        assertFalse(BuildConfig.SYNC_LAB_ENABLED)
        assertFalse(BuildConfig.NORMAL_OWNER_SIGN_IN_ONLY)
        val assets = AndroidAssetSource(ApplicationProvider.getApplicationContext<Context>())
        val catalog = ContentJson.json.decodeFromString(ContentCatalog.serializer(), assets.read(ContentRepository.CATALOG))
        assertEquals(listOf("mat-a-local"), catalog.tracks.map { it.track })
        val loaded = ContentRepository(assets, AppBuildInfo(BuildConfig.DEVELOPER_DEMO, BuildConfig.VERSION_NAME)).tracks().single()
        assertEquals("mat-a-local", loaded.track)
        assertFalse(loaded.pack.synthetic)
        assertTrue(loaded.problems.isEmpty())
        assertEquals(14, loaded.content.items.size)
        assertEquals(1, loaded.content.screens.size)
        assertEquals(listOf("01"), loaded.freeUnits)
    }

    @Test fun installedResourceBytesMatchTheExistingReviewedRegistryProof() {
        val assets = AndroidAssetSource(ApplicationProvider.getApplicationContext<Context>())
        val proof = requireNotNull(javaClass.getResourceAsStream("/reviewed-math/client-proof.json"))
            .bufferedReader().use { it.readText() }
        val expected = Json.decodeFromString(PackProof.serializer(), proof)
        val actual = PackProof.fromBytes(
            assets.read("packs/matematika/mat-a-local/v1.json").encodeToByteArray(),
            assets.read("config/rules.mat-a-local.json").encodeToByteArray(),
            expected.sourceCommit,
        )
        assertEquals(expected, actual)
    }
}
