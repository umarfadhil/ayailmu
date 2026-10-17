package id.petalytix.ayailmu.core.content

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json

/** JSON configuration shared by packs, rules and stored events: tolerant of new keys, no nulls on disk. */
@OptIn(ExperimentalSerializationApi::class)
object ContentJson {
    val json: Json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = false
            prettyPrint = false
        }
}

/** Parses a pack from JSON text. Android reads the asset stream; the CLI and tests read files. */
object PackLoader {
    fun parse(text: String): ContentPack = ContentJson.json.decodeFromString(ContentPack.serializer(), text)

    fun encode(pack: ContentPack): String = ContentJson.json.encodeToString(ContentPack.serializer(), pack)
}
