package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.PackValidator
import id.petalytix.ayailmu.core.content.StrokeIndex
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.io.FileNotFoundException

/**
 * The bundled pronunciation clips (`assets/audio/index.json`, written by `android/tools/voice_gen.py`,
 * INTERACTIONS_AUDIO.md §3.1): `{"clips": {"en/apple": "<sha1 of the text>"}}`. Only the keys matter here: a key in
 * [clips] has its `audio/<lang>/<slug>.mp3` in the APK; any other clip counts as missing (item hidden, speaker hidden).
 */
data class AudioIndex(
    val clips: Set<String> = emptySet(),
) {
    fun has(clip: String): Boolean = clip in clips

    companion object {
        val EMPTY = AudioIndex()

        /**
         * Reads the index text. Keys that are not clip keys (`<lang>/<slug>`, [PackValidator.isClipKey]) are dropped,
         * so a stray key can never name a file outside `audio/`. Text that is not an index object throws
         * (IllegalArgumentException, which includes kotlinx SerializationException); callers treat that as no clips.
         */
        fun parse(text: String): AudioIndex {
            val root = ContentJson.json.parseToJsonElement(text) as? JsonObject
            requireNotNull(root) { "audio index is not an object" }
            val clips = root["clips"] as? JsonObject
            requireNotNull(clips) { "audio index has no \"clips\" object" }
            return AudioIndex(clips.keys.filter { PackValidator.isClipKey(it) }.toSet())
        }
    }
}

/**
 * Loads the two media indexes once per process (follow-up 11): the voice clips ([audio], `audio/index.json`) and the
 * stroke data for `trace` items ([strokes], `strokes/index.json`, INTERACTIONS_AUDIO.md §4).
 *
 * A missing file means "none yet" and is not an error: packs stay playable because the items that need the medium
 * are left out ([ContentFilters]). An unreadable file is reported through [log] and treated the same way. Glyphs
 * with structural problems ([StrokeIndex.problems]) are left out of the stroke index, so their trace items are too.
 */
class MediaRepository(
    private val assets: AssetSource,
    private val log: (String) -> Unit = {},
) {
    private val lock = Mutex()
    private var audio: AudioIndex? = null
    private var strokes: StrokeIndex? = null

    suspend fun audio(): AudioIndex = lock.withLock { audio ?: load(AUDIO, AudioIndex.EMPTY, AudioIndex::parse).also { audio = it } }

    suspend fun strokes(): StrokeIndex =
        lock.withLock { strokes ?: load(STROKES, StrokeIndex()) { usable(StrokeIndex.parse(it)) }.also { strokes = it } }

    private fun usable(index: StrokeIndex): StrokeIndex {
        val problems = index.problems()
        if (problems.isEmpty()) return index
        val bad = index.keys.keys.filter { k -> problems.any { p -> p.path == "strokes.$k" || p.path.startsWith("strokes.$k.") } }.toSet()
        log("$STROKES: left out ${bad.sorted().joinToString()} (${problems.first()})")
        return StrokeIndex(index.keys - bad)
    }

    private suspend fun <T> load(
        path: String,
        empty: T,
        parse: (String) -> T,
    ): T =
        withContext(Dispatchers.IO) {
            val text =
                try {
                    assets.read(path)
                } catch (e: FileNotFoundException) {
                    return@withContext empty
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log("$path: not readable (${e.message})")
                    return@withContext empty
                }
            try {
                parse(text)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log("$path: not a valid index (${e.message})")
                empty
            }
        }

    companion object {
        const val AUDIO = "audio/index.json"
        const val STROKES = "strokes/index.json"
    }
}
