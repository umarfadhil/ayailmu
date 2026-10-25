package id.petalytix.ayailmu

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.core.content.FileProvider
import id.petalytix.ayailmu.core.data.export.ExportBuilder
import id.petalytix.ayailmu.core.data.export.ExportFiles
import id.petalytix.ayailmu.feature.common.shareIntent
import id.petalytix.ayailmu.feature.common.startShare
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.FileNotFoundException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalExportSafetyTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        // Robolectric gives each test a fresh cache root; clear FileProvider's own root cache as Android would on process restart.
        @Suppress("UNCHECKED_CAST")
        val cache = FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }.get(null) as MutableMap<String, Any>
        cache.clear()
        ExportFiles.clear(context)
    }

    @After
    fun tearDown() = ExportFiles.clear(context)

    private fun bundle(json: String, csv: String) = ExportBuilder.Bundle(json = json, csv = csv)

    private fun read(uri: Uri): String =
        context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            ?: error("provider returned no stream")

    private fun retiredOrUnchanged(uri: Uri, expected: String): String? =
        try {
            read(uri).also { assertEquals(expected, it) }
        } catch (_: FileNotFoundException) {
            null
        }

    @Test
    fun `provider reads both files and clear removes the bundle`() = runTest {
        val uris = ExportFiles.write(context, bundle("synthetic-json", "synthetic-csv"), "20261025-1010")

        assertEquals("synthetic-json", read(uris[0]))
        assertEquals("synthetic-csv", read(uris[1]))
        ExportFiles.clear(context)
        assertFalse(File(context.cacheDir, ExportFiles.DIR).exists())
    }

    @Test
    fun `same stamp exports never reuse a granted uri for new content`() = runTest {
        val old = ExportFiles.write(context, bundle("old-json", "old-csv"), "20261025-1010")
        val new = ExportFiles.write(context, bundle("new-json", "new-csv"), "20261025-1010")

        assertNotEquals(old, new)
        assertNull(retiredOrUnchanged(old[0], "old-json"))
        assertNull(retiredOrUnchanged(old[1], "old-csv"))
        assertEquals("new-json", read(new[0]))
        assertEquals("new-csv", read(new[1]))
    }

    @Test
    fun `provider failure cleans only the new bundle and preserves the old one`() = runTest {
        val old = ExportFiles.write(context, bundle("old-json", "old-csv"), "20261025-1010")
        val before = File(context.cacheDir, ExportFiles.DIR).listFiles()?.map { it.name }?.toSet().orEmpty()
        val invalidProvider =
            object : ContextWrapper(context) {
                override fun getPackageName(): String = "invalid.synthetic.provider"
            }

        try {
            ExportFiles.write(invalidProvider, bundle("new-json", "new-csv"), "20261025-1010")
            fail("invalid provider authority must fail")
        } catch (_: IllegalArgumentException) {
            // Expected after both synthetic files have been written.
        }

        val after = File(context.cacheDir, ExportFiles.DIR).listFiles()?.map { it.name }?.toSet().orEmpty()
        assertEquals(before, after)
        assertEquals("old-json", read(old[0]))
        assertEquals("old-csv", read(old[1]))
    }

    @Test
    fun `share launch reports missing activity and security failures without throwing`() {
        val uris = listOf(Uri.parse("content://synthetic/json"), Uri.parse("content://synthetic/csv"))
        val missing =
            object : ContextWrapper(context) {
                override fun startActivity(intent: Intent) = throw ActivityNotFoundException("synthetic")
            }
        val refused =
            object : ContextWrapper(context) {
                override fun startActivity(intent: Intent) = throw SecurityException("synthetic")
            }

        assertFalse(startShare(missing, uris, "Export"))
        assertFalse(startShare(refused, uris, "Export"))
    }

    @Suppress("DEPRECATION")
    @Test
    fun `successful handoff retains read only grants and both clip uris`() {
        val uris = listOf(Uri.parse("content://synthetic/json"), Uri.parse("content://synthetic/csv"))
        var launched: Intent? = null
        val recipient =
            object : ContextWrapper(context) {
                override fun startActivity(intent: Intent) {
                    launched = intent
                }
            }

        assertTrue(startShare(recipient, uris, "Export"))
        val chooser = launched ?: error("chooser not launched")
        val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: error("missing send intent")
        assertEquals(shareIntent(uris, "Export").action, chooser.action)
        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
        assertEquals(0, send.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        assertEquals(uris, (0 until send.clipData!!.itemCount).map { send.clipData!!.getItemAt(it).uri })
    }
}
