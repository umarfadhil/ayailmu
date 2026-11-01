package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.sync.AuthFailure
import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.AuthUser
import java.time.Instant
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*

private fun session(email: String, access: String = "access-$email", confirmed: Boolean = true) = AuthSession(
    access, "refresh-$access", 60, "bearer",
    AuthUser("id-$email", email, if (confirmed) "2026-10-26T00:00:00Z" else null),
)

class NormalAccountTest {
    private val emailA = "owner.a@example.invalid"
    private val emailB = "owner.b@example.invalid"
    private val passwordA = "correct horse battery"
    private val passwordB = "another safe password"

    private class FakeGateway : NormalAuthGateway {
        val users = mutableMapOf<String, AuthUser>()
        val passwords = mutableMapOf<String, String>()
        val sessions = mutableMapOf<String, AuthSession>()
        val signIns = mutableMapOf<String, CompletableDeferred<AuthSession>>()
        val signInStarted = CompletableDeferred<String>()
        var networkCalls = 0
        var failNext: Exception? = null
        var loseSignUpReply = false
        var loseOtpReply = false
        val mailIds = mutableListOf<Pair<String, String>>()
        var mailGate: CompletableDeferred<Unit>? = null
        val mailEntered = CompletableDeferred<Unit>()
        private suspend fun mail(action: String, id: String) { mailIds += action to id; mailEntered.complete(Unit); mailGate?.await(); request() }
        private val usedCodes = mutableSetOf<Pair<String, String>>()
        private fun request() { networkCalls++; failNext?.let { failNext = null; throw it } }
        var refreshed = 0
        var tokenCounter = 0
        var logoutCalls = 0
        val expiredAccess = mutableSetOf<String>()
        override suspend fun signUp(email: String, password: String, operationId: String) {
            mail("signup", operationId)
            // Model enumeration-safe repeated signup without replacing the existing identity.
            if (email !in users) {
                users[email] = AuthUser(java.util.UUID.nameUUIDFromBytes(email.encodeToByteArray()).toString(), email)
                passwords[email] = password
            }
            if (loseSignUpReply) { loseSignUpReply = false; throw java.io.IOException("synthetic lost signup reply") }
        }
        override suspend fun signIn(email: String, password: String): AuthSession {
            request()
            signIns[email]?.let { signInStarted.complete(email); return it.await() }
            val user = users[email] ?: throw AuthFailure(400, "invalid_credentials")
            if (passwords[email] != password) throw AuthFailure(400, "invalid_credentials")
            if (user.emailConfirmedAt == null) throw AuthFailure(400, "email_not_confirmed")
            return session(email, "access-${++tokenCounter}-$email").copy(user = user).also { sessions[it.accessToken] = it }
        }
        override suspend fun verifyOtp(email: String, code: String, type: String): AuthSession {
            request()
            if (code != if (type == "signup") "111111" else "222222") throw AuthFailure(400, "invalid_otp")
            val key = email to type
            if (email !in users || key in usedCodes) throw AuthFailure(400, "invalid_otp")
            usedCodes += key
            if (type == "signup") users[email] = users.getValue(email).copy(emailConfirmedAt = "2026-10-26T00:00:00Z")
            if (loseOtpReply) { loseOtpReply = false; throw java.io.IOException("synthetic lost OTP reply") }
            return session(email, "access-$type-$email").copy(user = users.getValue(email)).also { sessions[it.accessToken] = it }
        }
        override suspend fun recover(email: String, operationId: String) { mail("recover", operationId) }
        override suspend fun resend(email: String, operationId: String) { mail("resend", operationId) }
        override suspend fun refresh(refreshToken: String): AuthSession {
            request(); refreshed++
            val old = sessions.values.first { it.refreshToken == refreshToken }
            return session(old.user.email, "rotated-${++tokenCounter}-${old.user.email}").copy(user = old.user).also { sessions[it.accessToken] = it }
        }
        override suspend fun user(token: String): AuthUser {
            request()
            if (token in expiredAccess) throw AuthFailure(401, "unauthorized")
            return sessions[token]?.user ?: users.values.firstOrNull { token.contains(it.email) } ?: throw AuthFailure(401, "unauthorized")
        }
        override suspend fun updatePassword(token: String, password: String): AuthUser {
            request()
            val user = sessions.getValue(token).user
            passwords[user.email] = password
            return user
        }
        override suspend fun signOut(token: String) { request(); logoutCalls++ }
    }

    private class FakeVault : NormalAuthVault, NormalMailStore {
        var pendingMail: SavedMailOperation? = null
        override fun readMail() = pendingMail
        override fun writeMail(value: SavedMailOperation?) { pendingMail = value }
        var saved: SavedNormalAuth? = null
        var failClear = false
        override fun read() = saved
        override fun write(value: SavedNormalAuth?) { if (value == null && failClear) error("synthetic storage failure"); saved = value }
    }

    private class FakeSync : NormalOwnerSync {
        var owner: String? = null
        var authenticated = false
        override suspend fun login(token: String, declaration: id.petalytix.ayailmu.core.sync.NormalOwnerDeclaration, accepted: () -> Boolean, onCommitted: ((Long) -> Unit)?) {
            check(accepted() && declaration.adultConfirmed); owner = "owner-$token"; authenticated = true; onCommitted?.invoke(1)
        }
        override suspend fun resume(token: String, accepted: () -> Boolean) { check(accepted()); checkNotNull(owner); authenticated = true }
        override suspend fun logout(accepted: () -> Boolean) { if (accepted()) { owner = null; authenticated = false } }
        override suspend fun expireSession(accepted: () -> Boolean) { if (accepted()) authenticated = false }
        override suspend fun revertLogin(mark: Long, accepted: () -> Boolean) { if (accepted()) { owner = null; authenticated = false } }
    }

    private class Harness(val gateway: FakeGateway = FakeGateway(), val vault: FakeVault = FakeVault(), val sync: FakeSync = FakeSync(), ownerSignInOnly: Boolean = false) {
        val clock = FixedClock(Instant.parse("2026-10-26T00:00:00Z"))
        val config = NormalAccountConfig.forValues(true, "https://accounts.petalytix.id", "owner-policy-1").copy(ownerSignInOnly = ownerSignInOnly)
        val account = NormalAccount(gateway, vault, sync, clock, config, testMail(clock, config.publicOrigin, vault))
        fun confirmed(email: String, password: String) {
            gateway.users[email] = AuthUser("id-$email", email, "2026-10-26T00:00:00Z")
            gateway.passwords[email] = password
        }
    }

    @Test fun ownerRemoteRejectsEveryEmailActionBeforeCallingProvider() = runTest {
        val h = Harness(ownerSignInOnly = true)
        assertFalse(h.account.signUp(emailA, passwordA, true))
        assertFalse(h.account.confirm(emailA, "111111", true))
        assertFalse(h.account.resend(emailA))
        assertFalse(h.account.recover(emailA))
        assertFalse(h.account.reset(emailA, "222222", passwordB))
        assertEquals(0, h.gateway.networkCalls)
        assertNull(h.vault.saved)
    }

    @Test fun ownerRemotePreservesConfirmedSignInRestoreAndLogout() = runTest {
        val h = Harness(ownerSignInOnly = true); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        h.gateway.expiredAccess += h.vault.saved!!.session.accessToken
        assertTrue(h.account.restore())
        assertEquals(1, h.gateway.refreshed)
        assertTrue(h.account.signOut())
        assertEquals(1, h.gateway.logoutCalls)
        assertNull(h.vault.saved)
    }

    @Test fun signupWaitsForRealConfirmationAndWrongOtpNeverInstallsASession() = runTest {
        val h = Harness()
        assertTrue(h.account.signUp(emailA, passwordA, true))
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
        h.gateway.passwords[emailA] = passwordA
        assertFalse(h.account.signIn(emailA, passwordA, true))
        assertEquals(NormalMessage.UNCONFIRMED, h.account.state.value.message)
        assertFalse(h.account.confirm(emailA, "000000", true))
        assertEquals(NormalMessage.INVALID_OTP, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertTrue(h.account.confirm(emailA, "111111", true))
        assertEquals(emailA, h.account.state.value.email)
        assertTrue(h.sync.authenticated)
    }

    @Test fun expiredAccessRefreshesAndColdRestoreVerifiesTheSameOwner() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        h.gateway.expiredAccess += h.vault.saved!!.session.accessToken
        val second = Harness(h.gateway, h.vault, h.sync)
        assertTrue(second.account.restore())
        assertEquals(emailA, second.account.state.value.email)
        assertTrue(h.gateway.refreshed > 0)
        assertTrue(second.vault.saved!!.session.accessToken.startsWith("rotated-"))
        second.account.signOut()
        assertNull(second.vault.saved)
        assertFalse(second.account.restore())
        assertTrue(second.account.signIn(emailA, passwordA, true))
    }

    @Test fun validColdRestoreDoesNotRotateRefreshToken() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        val second = Harness(h.gateway, h.vault, h.sync)
        assertTrue(second.account.restore())
        assertEquals(0, h.gateway.refreshed)
        assertEquals(emailA, second.account.state.value.email)
    }

    @Test fun goTrueExpiredAccess403BadJwtRefreshesTheVerifiedOwner() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        h.gateway.failNext = AuthFailure(403, "bad_jwt")
        val second = Harness(h.gateway, h.vault, h.sync)
        assertTrue(second.account.restore())
        assertEquals(1, h.gateway.refreshed)
        assertEquals(emailA, second.account.state.value.email)
        assertTrue(second.vault.saved!!.session.accessToken.startsWith("rotated-"))
    }

    @Test fun unrelatedForbiddenUserResponseNeverAttemptsRefresh() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        val stored = h.vault.saved
        h.gateway.failNext = AuthFailure(403, "not_admin")
        val second = Harness(h.gateway, h.vault, h.sync)
        assertFalse(second.account.restore())
        assertEquals(0, h.gateway.refreshed)
        assertNull(second.account.state.value.email)
        assertEquals(stored, second.vault.saved)
    }

    @Test fun cancelledLateACannotOverwriteB() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA); h.confirmed(emailB, passwordB)
        val aResponse = CompletableDeferred<AuthSession>()
        h.gateway.signIns[emailA] = aResponse
        val a = async { h.account.signIn(emailA, passwordA, true) }
        assertEquals(emailA, h.gateway.signInStarted.await())
        assertTrue(h.account.signIn(emailB, passwordB, true))
        val bToken = h.vault.saved!!.session.accessToken
        aResponse.complete(session(emailA))
        assertFalse(a.await())
        assertEquals(emailB, h.account.state.value.email)
        assertEquals(bToken, h.vault.saved!!.session.accessToken)
        assertEquals("owner-$bToken", h.sync.owner)
    }


    @Test fun lateCredentialResponseCannotInstallAfterRouteCancellation() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        val response = CompletableDeferred<AuthSession>()
        h.gateway.signIns[emailA] = response
        val pending = async { h.account.signIn(emailA, passwordA, true) }
        assertEquals(emailA, h.gateway.signInStarted.await())
        h.account.cancel()
        response.complete(session(emailA))
        assertFalse(pending.await())
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
        assertNull(h.account.state.value.email)
    }

    @Test fun recoveryResetEndsRecoverySessionAndRequiresFreshLogin() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.recover(emailA))
        assertFalse(h.account.reset(emailA, "000000", passwordB))
        assertEquals(NormalMessage.INVALID_OTP, h.account.state.value.message)
        assertTrue(h.account.reset(emailA, "222222", passwordB))
        assertNull(h.vault.saved)
        assertFalse(h.account.signIn(emailA, passwordA, true))
        assertEquals(NormalMessage.INVALID_LOGIN, h.account.state.value.message)
        assertTrue(h.account.signIn(emailA, passwordB, true))
        assertTrue(h.gateway.logoutCalls > 0)
    }


    @Test fun failedDurableClearNeverReportsSignedOut() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        h.vault.failClear = true
        assertFalse(h.account.signOut())
        assertNotNull(h.vault.saved)
        assertTrue(h.sync.authenticated)
        assertEquals(NormalMessage.FAILED, h.account.state.value.message)
        h.vault.failClear = false
        assertTrue(h.account.signOut())
    }

    @Test fun recoveryResetAlsoClearsAnyPreviouslyActiveOwner() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        assertTrue(h.account.reset(emailA, "222222", passwordB))
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
        assertFalse(h.sync.authenticated)
    }


    @Test fun throttlingAndOfflineHaveActionableOperationAwareMessages() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        h.gateway.failNext = AuthFailure(429, "over_rate_limit")
        assertFalse(h.account.signUp(emailA, passwordA, true))
        assertEquals(NormalMessage.THROTTLED, h.account.state.value.message)
        h.gateway.failNext = AuthFailure(429, "over_rate_limit")
        assertFalse(h.account.confirm(emailA, "111111", true))
        assertEquals(NormalMessage.THROTTLED, h.account.state.value.message)
        h.gateway.failNext = AuthFailure(429, "over_rate_limit")
        assertFalse(h.account.recover(emailA))
        assertEquals(NormalMessage.THROTTLED, h.account.state.value.message)
        h.gateway.failNext = AuthFailure(429, "over_rate_limit")
        assertFalse(h.account.reset(emailA, "222222", passwordB))
        assertEquals(NormalMessage.THROTTLED, h.account.state.value.message)
        h.gateway.failNext = java.io.IOException("synthetic offline")
        assertFalse(h.account.signIn(emailA, passwordA, true))
        assertEquals(NormalMessage.OFFLINE, h.account.state.value.message)
    }


    @Test fun localAccountCleanupClearsVaultAndLongLivedState() = runTest {
        val h = Harness(); h.confirmed(emailA, passwordA)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        h.account.clearLocalAuthState()
        assertNull(h.vault.saved)
        assertNull(h.account.state.value.email)
        assertFalse(h.account.restore())
    }

    @Test fun configurationAndInputFailClosedBeforeNetwork() = runTest {
        assertFalse(NormalAccountConfig.forValues(false, "https://accounts.petalytix.id", "owner-policy-1").enabled)
        assertFalse(NormalAccountConfig.forValues(true, "http://accounts.petalytix.id", "owner-policy-1").enabled)
        assertFalse(NormalAccountConfig.forValues(true, "https://User@accounts.petalytix.id/path", "owner-policy-1").enabled)
        assertTrue(NormalInput.email(emailA))
        assertTrue(NormalInput.email("owner@petalytix.id"))
        assertFalse(NormalInput.email("not-an-address"))
        assertFalse(NormalInput.password("short"))
        assertTrue(NormalInput.password(passwordA))
        val h = Harness()
        assertFalse(h.account.signIn(emailA, "short"))
        assertEquals(0, h.gateway.networkCalls)
    }

    @Test fun generalSignupRejectsInvalidInputAndMissingDeclarationBeforeNetwork() = runTest {
        val h = Harness()
        assertFalse(h.account.signUp("not-an-address", passwordA, true))
        assertFalse(h.account.signUp(emailA, "short", true))
        assertFalse(h.account.signUp(emailA, passwordA, false))
        assertFalse(h.account.confirm(emailA, "11111", true))
        assertFalse(h.account.confirm(emailA, "111111", false))
        assertFalse(h.account.resend("not-an-address"))
        assertEquals(0, h.gateway.networkCalls)
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
    }

    @Test fun resendRequiresConfirmationAndReportsThrottleAndUnknownOutcome() = runTest {
        val h = Harness()
        assertTrue(h.account.signUp(emailA, passwordA, true))
        assertTrue(h.account.resend(emailA))
        assertEquals(NormalMessage.RESENT, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertTrue(h.account.newMailRequest())
        h.gateway.failNext = AuthFailure(429, "over_rate_limit")
        assertFalse(h.account.resend(emailA))
        assertEquals(NormalMessage.THROTTLED, h.account.state.value.message)
        h.gateway.failNext = java.io.IOException("synthetic lost resend reply")
        assertFalse(h.account.resend(emailA))
        assertEquals(NormalMessage.MAIL_UNKNOWN, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
    }

    @Test fun lostSignupAndOtpRepliesNeverInstallOrClaimALocalSession() = runTest {
        val h = Harness()
        h.gateway.loseSignUpReply = true
        assertFalse(h.account.signUp(emailA, passwordA, true))
        assertEquals(NormalMessage.MAIL_UNKNOWN, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
        h.gateway.loseOtpReply = true
        assertFalse(h.account.confirm(emailA, "111111", true))
        assertEquals(NormalMessage.OFFLINE, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertNull(h.sync.owner)
        // The provider may already have consumed the code before its response was lost.
        assertFalse(h.account.confirm(emailA, "111111", true))
        assertEquals(NormalMessage.INVALID_OTP, h.account.state.value.message)
        assertNull(h.vault.saved)
        assertTrue(h.account.signIn(emailA, passwordA, true))
        assertNotNull(h.vault.saved)
    }

    @Test fun repeatedSignupCannotReplaceAConfirmedIdentityOrPassword() = runTest {
        val h = Harness()
        assertTrue(h.account.signUp(emailA, passwordA, true))
        assertTrue(h.account.confirm(emailA, "111111", true))
        val identity = h.vault.saved!!.session.user.id
        assertTrue(h.account.signOut())
        assertTrue(h.account.signUp(emailA, passwordB, true))
        assertTrue(h.account.signIn(emailA, passwordA, true))
        assertEquals(identity, h.vault.saved!!.session.user.id)
        assertFalse(h.account.signIn(emailA, passwordB, true))
        assertEquals(identity, h.vault.saved!!.session.user.id)
    }

    @Test fun twoGeneralRecipientsKeepIndependentUuidSessionsAndVaults() = runTest {
        val provider = FakeGateway()
        val a = Harness(provider)
        val b = Harness(provider)
        assertTrue(a.account.signUp(emailA, passwordA, true))
        assertTrue(b.account.signUp(emailB, passwordB, true))
        assertTrue(a.account.confirm(emailA, "111111", true))
        assertTrue(b.account.confirm(emailB, "111111", true))
        val savedA = requireNotNull(a.vault.saved)
        val savedB = requireNotNull(b.vault.saved)
        val idA = java.util.UUID.fromString(savedA.session.user.id)
        val idB = java.util.UUID.fromString(savedB.session.user.id)
        assertNotEquals(idA, idB)
        assertNotEquals(savedA.session.accessToken, savedB.session.accessToken)
        assertNotEquals(a.sync.owner, b.sync.owner)
        assertTrue(a.account.signOut())
        assertNull(a.vault.saved)
        assertEquals(savedB, b.vault.saved)
        assertTrue(b.sync.authenticated)
        assertTrue(b.account.restore())
        assertEquals(idB.toString(), b.vault.saved?.session?.user?.id)
    }

    @Test fun concurrentDuplicateMailTapCannotInvalidateOrRepeatTheOriginal() = runTest {
        val h = Harness(); h.gateway.mailGate = CompletableDeferred()
        val first = async { h.account.recover(emailA) }
        h.gateway.mailEntered.await()
        assertFalse(h.account.recover(emailA))
        assertEquals(1, h.gateway.mailIds.size)
        h.gateway.mailGate!!.complete(Unit)
        assertTrue(first.await())
        assertEquals(NormalMessage.RECOVERY_SENT, h.account.state.value.message)
    }
    @Test fun lostResponseRetryAndRecreationUseTheOriginalIdWithoutClaimingSent() = runTest {
        val h = Harness(); h.gateway.failNext = java.io.IOException("synthetic lost response")
        assertFalse(h.account.recover(emailA))
        val original = h.gateway.mailIds.single().second
        assertEquals(NormalMessage.MAIL_UNKNOWN, h.account.state.value.message)
        val restored = Harness(h.gateway, h.vault, h.sync)
        assertFalse(restored.account.restore())
        assertEquals(1, h.gateway.mailIds.size)
        assertTrue(restored.account.recover(emailA))
        assertEquals(original, h.gateway.mailIds.last().second)
    }
    @Test fun recreatedSignupRequiresNewIntentButStillOffersConfirmation() = runTest {
        val h = Harness(); h.gateway.loseSignUpReply = true
        assertFalse(h.account.signUp(emailA, passwordA, true))
        val restored = Harness(h.gateway, h.vault, h.sync)
        val before = h.gateway.networkCalls
        assertFalse(restored.account.signUp(emailA, passwordA, true))
        assertEquals(before, h.gateway.networkCalls)
        assertEquals(NormalMessage.MAIL_NEW_REQUIRED, restored.account.state.value.message)
        assertEquals(emailA, restored.account.state.value.mail!!.recipient)
        assertTrue(restored.account.confirm(emailA, "111111", true))
        assertNull(h.vault.pendingMail)
    }
    @Test fun logoutAndOwnerChangeDiscardOldIntentAndFenceCancelledMail() = runTest {
        val h = Harness(); h.gateway.mailGate = CompletableDeferred()
        val pending = async { h.account.recover(emailA) }
        h.gateway.mailEntered.await()
        assertTrue(h.account.signOut())
        h.gateway.mailGate!!.complete(Unit)
        assertFalse(pending.await())
        assertNull(h.vault.pendingMail)
        h.gateway.mailGate = null
        assertTrue(h.account.recover(emailB))
        assertNotEquals(h.gateway.mailIds[0].second, h.gateway.mailIds[1].second)
        assertEquals(emailB, h.vault.pendingMail!!.recipient)
    }


    @Test fun coroutineCancellationPreservesUncertainIdAndClearsBusyWithoutSendingAgain() = runTest {
        val h = Harness(); h.gateway.mailGate = CompletableDeferred()
        val request = async { h.account.recover(emailA) }
        h.gateway.mailEntered.await()
        val original = h.gateway.mailIds.single().second
        request.cancel()
        request.join()
        assertFalse(h.account.state.value.busy)
        assertEquals(MailPhase.UNKNOWN, h.vault.pendingMail!!.phase)
        assertEquals(NormalMessage.MAIL_UNKNOWN, h.account.state.value.message)
        assertEquals(1, h.gateway.mailIds.size)
        h.gateway.mailGate = null
        assertTrue(h.account.recover(emailA))
        assertEquals(original, h.gateway.mailIds.last().second)
    }

}
