package id.petalytix.ayailmu.core.sync

import java.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.CompositeDecoder
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.encoding.decodeStructure
import kotlinx.serialization.encoding.encodeStructure

/** Minimal server evidence. This never contains an account identity or recovery credential. */
@Serializable(with = AccountDeletionReceiptSerializer::class)
data class AccountDeletionReceipt(
    val deletionId: String,
    val scope: String,
    val requestId: String,
    val status: String,
    val appDataErasedAt: String,
    val identityDeletedAt: String? = null,
) {
    val completed get() = status == "completed"
    fun requireValid(expectedRequest: String) {
        require(accountErasureUUID(deletionId) && accountErasureUUID(requestId) && requestId == expectedRequest)
        require(scope == "account" && status in setOf("identity_deletion_pending", "completed"))
        require(appDataErasedAt.length <= 40)
        val app = Instant.parse(appDataErasedAt)
        if (completed) {
            val deleted = requireNotNull(identityDeletedAt)
            require(deleted.length <= 40 && !Instant.parse(deleted).isBefore(app))
        } else require(identityDeletedAt == null)
    }
}

/** Streaming decode deliberately rejects duplicate fields instead of JsonObject's last-value-wins. */
object AccountDeletionReceiptSerializer : KSerializer<AccountDeletionReceipt> {
    private val names = listOf("deletion_id", "scope", "request_id", "status", "app_data_erased_at", "identity_deleted_at")
    override val descriptor = buildClassSerialDescriptor("AccountDeletionReceipt") {
        names.forEachIndexed { i, name -> element<String>(name, isOptional = i == 5) }
    }
    override fun deserialize(decoder: Decoder): AccountDeletionReceipt = decoder.decodeStructure(descriptor) {
        val values = mutableMapOf<Int, String>()
        while (true) {
            val index = decodeElementIndex(descriptor)
            if (index == CompositeDecoder.DECODE_DONE) break
            if (index !in names.indices || index in values) throw SerializationException("Ambiguous erasure receipt")
            values[index] = decodeStringElement(descriptor, index)
        }
        if (!(0..4).all { it in values }) throw SerializationException("Incomplete erasure receipt")
        AccountDeletionReceipt(values.getValue(0), values.getValue(1), values.getValue(2), values.getValue(3), values.getValue(4), values[5])
            .also { it.requireValid(it.requestId) }
    }
    override fun serialize(encoder: Encoder, value: AccountDeletionReceipt) = encoder.encodeStructure(descriptor) {
        value.requireValid(value.requestId)
        val values = listOf(value.deletionId, value.scope, value.requestId, value.status, value.appDataErasedAt, value.identityDeletedAt)
        values.forEachIndexed { index, s -> if (s != null) encodeStringElement(descriptor, index, s) }
    }
}

fun accountErasureUUID(value: String) = CANONICAL_UUID.matches(value) && value != "00000000-0000-0000-0000-000000000000"
fun accountErasureProof(value: String) = value.matches(Regex("[0-9a-f]{64}"))

interface AccountErasureApi {
    suspend fun begin(token: String, accountId: String, requestId: String, recoveryProof: String): AccountDeletionReceipt
    /** Null means a definitive HTTP 404 only. Network, malformed, forbidden and server errors throw. */
    suspend fun status(requestId: String, recoveryProof: String): AccountDeletionReceipt?
}
