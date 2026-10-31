package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.FixedClock
import java.time.Instant
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

internal class MemoryMailStore : NormalMailStore {
    var value: SavedMailOperation? = null
    var fail = false
    override fun readMail(): SavedMailOperation? { check(!fail); return value }
    override fun writeMail(value: SavedMailOperation?) { check(!fail); this.value = value }
}
internal fun testMail(clock: Clock, origin: String, store: NormalMailStore = MemoryMailStore()): NormalMailOperations {
    var id = 0
    return NormalMailOperations(store, clock, origin) { "00000000-0000-0000-0000-${(++id).toString().padStart(12, '0')}" }
}

class NormalMailOperationsTest {
    private val clock = FixedClock(Instant.parse("2026-10-30T00:00:00Z"))
    private val origin = "https://accounts.example.invalid"
    private fun ticket(result: MailAdmission) = (result as MailAdmission.Send).ticket

    @Test fun duplicateTapAndUnknownReplyReuseOneExactLogicalOperation() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        val a = ticket(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-one", "anonymous"))
        assertTrue(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-one", "anonymous") is MailAdmission.Busy)
        mail.finish(a, MailPhase.UNKNOWN)
        val retry = ticket(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-one", "anonymous"))
        assertEquals(a.id, retry.id)
        mail.finish(retry, MailPhase.ACCEPTED)
        assertTrue(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-one", "anonymous") is MailAdmission.AlreadyAccepted)
    }
    @Test fun clockTickDuringAdmissionDoesNotCorruptPersistedOperation() {
        var instant = clock.now()
        val ticking = object : Clock {
            override val zone = clock.zone
            override fun now(): Instant = instant.also { instant = it.plusMillis(1) }
        }
        val store = MemoryMailStore()
        val first = testMail(ticking, origin, store)
        val request = ticket(first.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "anonymous"))
        assertEquals(86_400_000L, store.value!!.expiresAtMs - store.value!!.createdAtMs)
        first.finish(request, MailPhase.UNKNOWN)
        val restored = testMail(ticking, origin, store)
        assertEquals(request.id, ticket(restored.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "anonymous")).id)
    }
    @Test fun recreatedSignupCannotGuessPasswordEqualityButOtherMailCanReplay() {
        for (action in NormalMailAction.entries) {
            val store = MemoryMailStore(); val first = testMail(clock, origin, store)
            val a = ticket(first.begin(action, "one@example.invalid", if (action == NormalMailAction.SIGN_UP) "password-one" else "", "anonymous"))
            val second = testMail(clock, origin, store)
            val result = second.begin(action, "one@example.invalid", if (action == NormalMailAction.SIGN_UP) "password-one" else "", "anonymous")
            if (action == NormalMailAction.SIGN_UP) assertTrue(result is MailAdmission.NewIntentRequired)
            else assertEquals(a.id, ticket(result).id)
        }
    }
    @Test fun correctedPayloadRequiresExplicitNewIntentAndNeverRetargetsAnId() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        val first = ticket(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-one", "anonymous")); mail.finish(first, MailPhase.UNKNOWN)
        assertTrue(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-two", "anonymous") is MailAdmission.NewIntentRequired)
        assertTrue(mail.newIntent())
        assertNotEquals(first.id, ticket(mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "password-two", "anonymous")).id)
    }
    @Test fun accountRecipientActionAndEnvironmentNeverShareOperationIdentity() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        var last = ticket(mail.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "owner-a")); mail.finish(last, MailPhase.UNKNOWN)
        for ((action, email, scope) in listOf(Triple(NormalMailAction.RESEND, "one@example.invalid", "owner-a"), Triple(NormalMailAction.RESEND, "two@example.invalid", "owner-a"), Triple(NormalMailAction.RESEND, "two@example.invalid", "owner-b"))) {
            val next = ticket(mail.begin(action, email, "", scope)); assertNotEquals(last.id, next.id); mail.finish(next, MailPhase.UNKNOWN); last = next
        }
        assertThrows(IllegalStateException::class.java) { testMail(clock, "https://other.example.invalid", store).begin(NormalMailAction.RESEND, "two@example.invalid", "", "owner-b") }
    }
    @Test fun clearFencesLateCompletionAndStorageFailurePreventsDispatch() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        val a = ticket(mail.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "anonymous"))
        mail.clear(); val b = ticket(mail.begin(NormalMailAction.RECOVER, "two@example.invalid", "", "anonymous"))
        mail.finish(a, MailPhase.ACCEPTED); assertEquals(b.id, store.value!!.id)
        store.fail = true
        assertThrows(IllegalStateException::class.java) { mail.begin(NormalMailAction.RESEND, "three@example.invalid", "", "anonymous") }
    }
    @Test fun expiryAndClockRollbackRequireNewExplicitIntentWithoutAutomaticSend() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        val a = ticket(mail.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "anonymous")); mail.finish(a, MailPhase.UNKNOWN)
        for (at in listOf("2026-10-29T23:59:59Z", "2026-10-31T00:00:00Z")) {
            val restored = testMail(FixedClock(Instant.parse(at)), origin, store)
            assertTrue(restored.begin(NormalMailAction.RECOVER, "one@example.invalid", "", "anonymous") is MailAdmission.NewIntentRequired)
            assertEquals(a.id, store.value!!.id)
        }
    }
    @Test fun journalNeverContainsPasswordOtpTokenOrPayloadDigest() {
        val store = MemoryMailStore(); val mail = testMail(clock, origin, store)
        mail.begin(NormalMailAction.SIGN_UP, "one@example.invalid", "do-not-persist-this-password", "anonymous")
        val saved = Json.encodeToString(SavedMailOperation.serializer(), store.value!!)
        assertFalse(saved.contains("do-not-persist")); assertFalse(saved.contains("digest")); assertFalse(saved.contains("token")); assertFalse(store.value.toString().contains("one@example.invalid"))
    }
}
