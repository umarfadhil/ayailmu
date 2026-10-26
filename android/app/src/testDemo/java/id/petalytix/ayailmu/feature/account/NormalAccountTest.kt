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
    private val emailA = "owner.a@gmail.com"
    private val emailB = "owner.b@outlook.com"
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
        private fun request() { networkCalls++; failNext?.let { failNext = null; throw it } }
        var refreshed = 0
        var tokenCounter = 0
        var logoutCalls = 0
        val expiredAccess = mutableSetOf<String>()
        override suspend fun signUp(email: String, password: String) { request(); users[email] = AuthUser("id-$email", email) }
        override suspend fun signIn(email: String, password: String): AuthSession {
            request()
            signIns[email]?.let { signInStarted.complete(email); return it.await() }
            val user = users[email] ?: throw AuthFailure(400, "invalid_credentials")
            if (passwords[email] != password) throw AuthFailure(400, "invalid_credentials")
            if (user.emailConfirmedAt == null) throw AuthFailure(400, "email_not_confirmed")
            return session(email, "access-${++tokenCounter}-$email").also { sessions[it.accessToken] = it }
        }
        override suspend fun verifyOtp(email: String, code: String, type: String): AuthSession {
            request()
            if (code != if (type == "signup") "111111" else "222222") throw AuthFailure(400, "invalid_otp")
            if (type == "signup") users[email] = users.getValue(email).copy(emailConfirmedAt = "2026-10-26T00:00:00Z")
            return session(email, "access-$type-$email").also { sessions[it.accessToken] = it }
        }
        override suspend fun recover(email: String) { request() }
        override suspend fun resend(email: String) { request() }
        override suspend fun refresh(refreshToken: String): AuthSession {
            request(); refreshed++
            val old = sessions.values.first { it.refreshToken == refreshToken }
            return session(old.user.email, "rotated-${++tokenCounter}-${old.user.email}").also { sessions[it.accessToken] = it }
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

    private class FakeVault : NormalAuthVault {
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

    private class Harness(val gateway: FakeGateway = FakeGateway(), val vault: FakeVault = FakeVault(), val sync: FakeSync = FakeSync()) {
        val account = NormalAccount(gateway, vault, sync, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), NormalAccountConfig.forValues(true, "https://accounts.petalytix.id", "owner-policy-1"))
        fun confirmed(email: String, password: String) {
            gateway.users[email] = AuthUser("id-$email", email, "2026-10-26T00:00:00Z")
            gateway.passwords[email] = password
        }
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
}