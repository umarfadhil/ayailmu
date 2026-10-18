package id.petalytix.ayailmu.core.billing

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.Serializer
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.io.OutputStream

/**
 * The last entitlements Play confirmed, kept so paid units stay open offline (CR-BIL-3). Stored as product ids
 * (stable) in `datastore/entitlements.json`; ids this build does not know are dropped on read.
 */
@Serializable
data class CachedEntitlements(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val owned: List<String> = emptyList(),
    val pending: List<String> = emptyList(),
    @SerialName("confirmed_at_ms") val confirmedAtMs: Long? = null,
) {
    fun toEntitlements(): Entitlements =
        Entitlements(
            owned = owned.mapNotNull { Product.fromPlayId(it) }.toSet(),
            pending = pending.mapNotNull { Product.fromPlayId(it) }.toSet(),
            confirmedAtEpochMs = confirmedAtMs,
        )

    companion object {
        fun of(e: Entitlements): CachedEntitlements =
            CachedEntitlements(
                owned = e.owned.map { it.playId }.sorted(),
                pending = e.pending.map { it.playId }.sorted(),
                confirmedAtMs = e.confirmedAtEpochMs,
            )
    }
}

interface EntitlementCache {
    suspend fun read(): Entitlements

    suspend fun write(value: Entitlements)
}

class DataStoreEntitlementCache(
    private val store: DataStore<CachedEntitlements>,
) : EntitlementCache {
    override suspend fun read(): Entitlements = store.data.first().toEntitlements()

    override suspend fun write(value: Entitlements) {
        store.updateData { CachedEntitlements.of(value) }
    }
}

class InMemoryEntitlementCache(
    initial: Entitlements = Entitlements(),
) : EntitlementCache {
    var value: Entitlements = initial
        private set

    override suspend fun read(): Entitlements = value

    override suspend fun write(value: Entitlements) {
        this.value = value
    }
}

object CachedEntitlementsSerializer : Serializer<CachedEntitlements> {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    override val defaultValue: CachedEntitlements = CachedEntitlements()

    override suspend fun readFrom(input: InputStream): CachedEntitlements =
        try {
            json.decodeFromString(CachedEntitlements.serializer(), input.readBytes().decodeToString())
        } catch (e: SerializationException) {
            throw CorruptionException("Unreadable entitlement cache", e)
        } catch (e: IllegalArgumentException) {
            throw CorruptionException("Unreadable entitlement cache", e)
        }

    override suspend fun writeTo(
        t: CachedEntitlements,
        output: OutputStream,
    ) {
        output.write(json.encodeToString(CachedEntitlements.serializer(), t).encodeToByteArray())
    }
}
