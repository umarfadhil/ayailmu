package id.petalytix.ayailmu.core.data.repo

import android.content.Context
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.ContentPack
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.content.PackProblem
import id.petalytix.ayailmu.core.content.PackValidator
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.engine.RuleConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Reads bundled text assets. Android uses AssetManager; tests read the same files from the classpath. */
fun interface AssetSource {
    fun read(path: String): String
}

class AndroidAssetSource(
    private val context: Context,
) : AssetSource {
    override fun read(path: String): String = context.assets.open(path).use { it.readBytes().decodeToString() }
}

/** `config/catalog.json`: which pack and which rules each track uses (one place to bump a content version). */
@Serializable
data class ContentCatalog(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val tracks: List<Entry>,
) {
    @Serializable
    data class Entry(
        val track: String,
        val pack: String,
        val rules: String,
    )
}

/** One track as the running build sees it: parsed, validated and gated for this flavor. */
data class LoadedTrack(
    val track: String,
    val pack: ContentPack,
    val rules: RuleConfig,
    val content: GatedContent,
    val problems: List<PackProblem>,
)

/**
 * Loads every track in the catalog once per process (CR-CFG-1, CR-ENG-2). A pack that fails validation is
 * still returned with its problems so the demo build can show them; prod shows only approved items anyway.
 */
class ContentRepository(
    private val assets: AssetSource,
    private val build: AppBuildInfo,
) {
    private val lock = Mutex()
    private var cache: List<LoadedTrack>? = null

    suspend fun tracks(): List<LoadedTrack> = lock.withLock { cache ?: load().also { cache = it } }

    suspend fun track(track: String): LoadedTrack? = tracks().firstOrNull { it.track == track }

    private suspend fun load(): List<LoadedTrack> =
        withContext(Dispatchers.IO) {
            val catalog = ContentJson.json.decodeFromString(ContentCatalog.serializer(), assets.read(CATALOG))
            catalog.tracks.map { entry ->
                val pack = PackLoader.parse(assets.read(entry.pack))
                val rules = RuleConfig.parse(assets.read(entry.rules))
                val problems = PackValidator.validate(pack).toMutableList()
                if (pack.meta.track != entry.track) problems += PackProblem("catalog", "pack track ${pack.meta.track} != ${entry.track}")
                if (rules.track != entry.track) problems += PackProblem("catalog", "rules track ${rules.track} != ${entry.track}")
                LoadedTrack(entry.track, pack, rules, Gating.gate(pack, build.developerDemo), problems)
            }
        }

    companion object {
        const val CATALOG = "config/catalog.json"
    }
}
