package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.AudioIndex
import id.petalytix.ayailmu.core.data.repo.ContentFilters
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.MediaRepository
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Pool
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.FileNotFoundException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Follow-up 11 (INTERACTIONS_AUDIO.md §3.1, §4): the voice clip index, the stroke index and the missing-clip rule.
 * Pure JVM: bundled assets come from the test classpath, overrides from a map (null = the file is missing).
 */
class MediaIndexTest {
    private val classpath =
        AssetSource { path ->
            val stream = MediaIndexTest::class.java.classLoader!!.getResourceAsStream(path) ?: throw FileNotFoundException(path)
            stream.use { it.readBytes().decodeToString() }
        }

    private fun assets(
        vararg overrides: Pair<String, String?>,
        reads: MutableList<String> = mutableListOf(),
    ): AssetSource {
        val map = overrides.toMap()
        return AssetSource { path ->
            reads += path
            if (path in map) map[path] ?: throw FileNotFoundException(path) else classpath.read(path)
        }
    }

    @Test
    fun `the audio index keeps clip keys only`() {
        val index = AudioIndex.parse("""{"clips": {"en/apple": "a1", "ko/sagwa": "b2", "Apple": "c", "../etc/x": "d", "en/": "e"}}""")
        assertEquals(setOf("en/apple", "ko/sagwa"), index.clips)
        assertTrue(index.has("ko/sagwa"))
        assertFalse(index.has("ja/ringo"))
        assertEquals(AudioIndex.EMPTY, AudioIndex.parse("""{"clips": {}}"""))
    }

    @Test
    fun `text that is not an audio index is refused`() {
        assertFailsWith<IllegalArgumentException> { AudioIndex.parse("not json") }
        assertFailsWith<IllegalArgumentException> { AudioIndex.parse("[]") }
        assertFailsWith<IllegalArgumentException> { AudioIndex.parse("""{"version": 1}""") }
        assertFailsWith<IllegalArgumentException> { AudioIndex.parse("""{"clips": ["en/apple"]}""") }
    }

    @Test
    fun `missing index files mean no clips and no strokes yet, without a warning`() =
        runTest {
            val logs = mutableListOf<String>()
            val media = MediaRepository(assets(MediaRepository.AUDIO to null, MediaRepository.STROKES to null)) { logs += it }
            assertEquals(AudioIndex.EMPTY, media.audio())
            assertTrue(media.strokes().keys.isEmpty())
            assertEquals(emptyList(), logs)
        }

    @Test
    fun `broken index files are logged, treated as empty and read only once`() =
        runTest {
            val logs = mutableListOf<String>()
            val reads = mutableListOf<String>()
            val files = assets(MediaRepository.AUDIO to "{not json", MediaRepository.STROKES to "[1, 2]", reads = reads)
            val media = MediaRepository(files) { logs += it }
            assertEquals(AudioIndex.EMPTY, media.audio())
            assertEquals(AudioIndex.EMPTY, media.audio())
            assertTrue(media.strokes().keys.isEmpty())
            assertTrue(media.strokes().keys.isEmpty())
            assertEquals(2, logs.size)
            assertEquals(listOf(MediaRepository.AUDIO, MediaRepository.STROKES), reads)
        }

    @Test
    fun `glyphs with broken strokes are left out and the good ones kept`() =
        runTest {
            val logs = mutableListOf<String>()
            val strokes =
                """{"keys": {"hira_a": {"glyph": "あ", "strokes": [[[0.1, 0.2], [0.8, 0.2]]]},""" +
                    """ "hira_i": {"glyph": "い", "strokes": [[[0.1, 0.2], [1.4, 0.2]]]}, "hira_u": {"glyph": "う", "strokes": []}}}"""
            val media = MediaRepository(assets(MediaRepository.STROKES to strokes)) { logs += it }
            assertEquals(setOf("hira_a"), media.strokes().keys.keys)
            assertEquals(1, logs.size)
        }

    @Test
    fun `the bundled stroke index loads without problems`() =
        runTest {
            val logs = mutableListOf<String>()
            val strokes = MediaRepository(classpath) { logs += it }.strokes()
            assertEquals(emptyList(), logs)
            assertTrue(strokes.keys.isEmpty() || "hira_a" in strokes.keys)
        }

    private fun item(
        id: String,
        type: ItemType,
        audio: String? = null,
        trace: String? = null,
    ) = Item(
        itemId = id,
        unit = "01",
        type = type,
        pool = Pool.PRACT,
        promptId = "P-1",
        audio = audio,
        trace = trace,
        contentVersion = "t-0.1",
    )

    private fun content(items: List<Item>) =
        GatedContent("t-0.1", "t", unreviewed = true, empty = items.isEmpty(), emptyMap(), emptyMap(), emptyList(), emptyMap(), items)

    @Test
    fun `audio_match needs its clip, trace needs its strokes, nothing else is filtered`() {
        val items =
            listOf(
                item("A1", ItemType.AUDIO_MATCH, audio = "en/one"),
                item("A2", ItemType.AUDIO_MATCH, audio = "en/two"),
                item("A3", ItemType.AUDIO_MATCH),
                item("T1", ItemType.TRACE, trace = "hira_a"),
                item("T2", ItemType.TRACE, trace = "hira_i", audio = "ja/i"),
                item("C1", ItemType.CHOOSE, audio = "en/three"),
            )
        val filtered = ContentFilters.playableMedia(content(items), { it == "en/one" }, { it == "hira_a" })
        assertEquals(listOf("A1", "T1", "C1"), filtered.items.map { it.itemId })
        assertFalse(filtered.empty)
        assertEquals("C1", filtered.item("C1").itemId)
        assertEquals(null, filtered.itemOrNull("A2"))

        val nothing = ContentFilters.playableMedia(content(items.take(3)), { false }, { false })
        assertTrue(nothing.empty)
        // An audio_match without any clip key can never play; with everything bundled, the rest is returned as is.
        assertEquals(5, ContentFilters.playableMedia(content(items), { true }, { true }).items.size)
        val playable = content(items.filterNot { it.itemId == "A3" })
        assertSame(playable, ContentFilters.playableMedia(playable, { true }, { true }))
    }

    /** The bundled `mat` pack with one item turned into an `audio_match` and one into a `trace` (parse only, not validated). */
    private fun matWithMedia(): String {
        val pack = Json.parseToJsonElement(classpath.read("packs/matematika/mat/v1.json")).jsonObject
        val items =
            pack.getValue("items").jsonArray.map { it.jsonObject }.map { o ->
                when (o.getValue("item_id").jsonPrimitive.content) {
                    "MAT-K-P-01-002" -> JsonObject(o + mapOf("type" to JsonPrimitive("audio_match"), "audio" to JsonPrimitive("en/one")))
                    "MAT-K-P-01-005" -> JsonObject(o + mapOf("type" to JsonPrimitive("trace"), "trace" to JsonPrimitive("hira_a")))
                    else -> o
                }
            }
        return JsonObject(pack + ("items" to JsonArray(items))).toString()
    }

    @Test
    fun `loaded tracks leave out items whose clip or strokes are not bundled`() =
        runTest {
            val catalog =
                """{"schema_version": 1, "tracks": [""" +
                    """{"track": "mat", "pack": "packs/matematika/mat/v1.json", "rules": "config/rules.mat.json"}]}"""
            val strokes = """{"keys": {"hira_a": {"glyph": "あ", "strokes": [[[0.1, 0.2], [0.8, 0.2]]]}}}"""
            val pack = matWithMedia()
            val build = AppBuildInfo(developerDemo = true, appVersion = "0.3.0")

            fun files() = assets(ContentRepository.CATALOG to catalog, "packs/matematika/mat/v1.json" to pack)

            fun repo(audio: String?): ContentRepository {
                val media = MediaRepository(assets(MediaRepository.AUDIO to audio, MediaRepository.STROKES to strokes))
                return ContentRepository(files(), build, media)
            }

            val total = Json.parseToJsonElement(pack).jsonObject.getValue("items").jsonArray.size
            val silent = repo(audio = null).track("mat")!!.content
            assertEquals(total - 1, silent.items.size)
            assertEquals(null, silent.itemOrNull("MAT-K-P-01-002"))
            assertEquals(ItemType.TRACE, silent.item("MAT-K-P-01-005").type)

            val voiced = repo(audio = """{"clips": {"en/one": "sha"}}""").track("mat")!!.content
            assertEquals(total, voiced.items.size)
            assertEquals(ItemType.AUDIO_MATCH, voiced.item("MAT-K-P-01-002").type)

            // Prod gating still comes first: nothing synthetic or unapproved appears because a clip exists.
            val prod = ContentRepository(files(), build.copy(developerDemo = false))
            assertTrue(prod.track("mat")!!.content.empty)
        }
}
