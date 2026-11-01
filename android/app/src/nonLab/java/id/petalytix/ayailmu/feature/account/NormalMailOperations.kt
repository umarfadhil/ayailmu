package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.engine.Clock
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import kotlinx.serialization.Serializable

@Serializable internal enum class NormalMailAction { SIGN_UP, RESEND, RECOVER }
@Serializable internal enum class MailPhase { IN_FLIGHT, UNKNOWN, ACCEPTED }
@Serializable internal data class SavedMailOperation(
    val id: String, val action: NormalMailAction, val recipient: String,
    val ownerScope: String, val environment: String, val createdAtMs: Long,
    val expiresAtMs: Long, val phase: MailPhase, val version: Int = 1,
) { override fun toString() = "SavedMailOperation(redacted)" }
internal interface NormalMailStore {
    fun readMail(): SavedMailOperation?
    fun writeMail(value: SavedMailOperation?)
}
internal data class MailTicket(val id: String, val recipient: String) { override fun toString() = "MailTicket(redacted)" }
internal sealed interface MailAdmission {
    data class Send(val ticket: MailTicket) : MailAdmission
    data object AlreadyAccepted : MailAdmission
    data object Busy : MailAdmission
    data object NewIntentRequired : MailAdmission
}

/** Durable intent, never an automatic retry worker. Payload equality is RAM-only;
 * encrypted metadata cannot reconstruct a signup password after recreation. */
internal class NormalMailOperations(
    private val store: NormalMailStore, private val clock: Clock,
    private val environment: String, private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private var active: String? = null
    private var payload: Pair<String, ByteArray>? = null
    private var previousId: String? = null
    private fun now() = clock.now().toEpochMilli()
    private fun read(): SavedMailOperation? = store.readMail()?.also {
        check(it.version == 1 && it.environment == environment && it.id.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}")))
        check(it.recipient.length <= 254 && it.ownerScope.length <= 256 && it.createdAtMs > 0 && it.expiresAtMs - it.createdAtMs == 86_400_000L)
    }
    @Synchronized fun pending(scope: String): SavedMailOperation? {
        val row = read() ?: return null
        if (row.ownerScope != scope) return null
        if (row.phase == MailPhase.IN_FLIGHT && active != row.id) {
            return row.copy(phase = MailPhase.UNKNOWN).also(store::writeMail)
        }
        return row
    }
    @Synchronized fun begin(action: NormalMailAction, email: String, password: String, scope: String): MailAdmission {
        val old = read()
        if (active != null) return MailAdmission.Busy
        val recipient = email.trim().lowercase(Locale.ROOT)
        check(NormalInput.email(recipient) && scope.length <= 256 && scope.isNotBlank())
        val bytes = MessageDigest.getInstance("SHA-256").digest((action.name + "\u0000" + recipient + "\u0000" + password).encodeToByteArray())
        val same = old != null && old.action == action && old.recipient == recipient && old.ownerScope == scope
        val row = if (same) {
            checkNotNull(old)
            if (now() < old.createdAtMs || now() >= old.expiresAtMs) return MailAdmission.NewIntentRequired
            val known = payload?.takeIf { it.first == old.id }?.second
            if (action == NormalMailAction.SIGN_UP && (known == null || !MessageDigest.isEqual(known, bytes))) return MailAdmission.NewIntentRequired
            if (old.phase == MailPhase.ACCEPTED) return MailAdmission.AlreadyAccepted
            old.copy(phase = MailPhase.IN_FLIGHT)
        } else {
            var id = newId()
            repeat(3) { if (id == old?.id || id == previousId) id = newId() }
            check(id != old?.id && id != previousId)
            check(id.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")))
            val createdAt = now()
            SavedMailOperation(id, action, recipient, scope, environment, createdAt, createdAt + 86_400_000L, MailPhase.IN_FLIGHT)
        }
        // Durable admission precedes any HTTP call. No secret or digest is persisted.
        store.writeMail(row)
        payload?.second?.fill(0)
        payload = row.id to bytes
        active = row.id
        return MailAdmission.Send(MailTicket(row.id, row.recipient))
    }
    @Synchronized fun finish(ticket: MailTicket, outcome: MailPhase) {
        if (active != ticket.id) return
        try { read()?.takeIf { it.id == ticket.id }?.let { store.writeMail(it.copy(phase = outcome)) } }
        finally { active = null }
    }
    @Synchronized fun newIntent(): Boolean {
        read()
        if (active != null) return false
        clear()
        return true
    }
    @Synchronized fun clear() {
        // Explicit account/logout boundary may discard corrupt metadata; a new
        // mail intent still calls read() first and therefore stays fail-closed.
        previousId = runCatching { read()?.id }.getOrNull() ?: previousId
        store.writeMail(null)
        active = null
        payload?.second?.fill(0)
        payload = null
    }
}
