package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.sync.AuthFailure
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NormalQaConfigTest {
    private val origin = "https://localhost:58443"
    private fun config(rawOrigin: String, approved: Boolean = true) = NormalAccountConfig.forValues(
        approved, rawOrigin, "qa-sync-v1", "qa-owner-v1", "0".repeat(40), origin,
    )
    @Test fun exactLocalhostOriginIsTheOnlyAcceptedQaEndpoint() {
        assertTrue(config(origin).enabled)
        val rejected = listOf(
            "http://localhost:58443", "https://127.0.0.1:58443", "https://localhost:58444",
            "https://sub.localhost:58443", "https://localhost:58443/", "https://localhost:58443/path",
            "https://localhost:58443?x=1", "https://localhost:58443#x", "https://user@localhost:58443",
            "https://LOCALHOST:58443", " $origin", "$origin ",
        )
        rejected.forEach { assertFalse("accepted $it", config(it).enabled) }
        assertFalse(config(origin, approved = false).enabled)
    }
    @Test fun productionDefaultDoesNotRequireQaOrigin() {
        val prod = NormalAccountConfig.forValues(true, "https://accounts.petalytix.id", "owner-sync-v1", "adult-owner-v1", "0".repeat(40))
        assertTrue(prod.enabled)
        assertEquals("", prod.requiredOrigin)
    }
    @Test fun ownerRemoteAdapterBlocksEmailEndpointsEvenIfCalledDirectly() = runTest {
        val configured = NormalAccountConfig.forValues(true, "https://owner.example.invalid", "qa-sync-v1").copy(ownerSignInOnly = true)
        val gateway = GoTrueNormalAuthGateway(configured)
        val actions: List<suspend () -> Unit> = listOf(
            { gateway.signUp("owner@example.invalid", "not-a-real-password") },
            { gateway.verifyOtp("owner@example.invalid", "111111", "signup"); Unit },
            { gateway.resend("owner@example.invalid") },
            { gateway.recover("owner@example.invalid") },
            { gateway.updatePassword("not-a-token", "not-a-real-password"); Unit },
        )
        actions.forEach { action ->
            val error = runCatching { action() }.exceptionOrNull()
            assertTrue(error is IllegalStateException)
            assertEquals("Email actions are unavailable in the owner-only connection", error?.message)
        }
    }
    @Test fun disabledGatewayCannotMakeNetworkCalls() = runTest {
        val disabled = config(origin, approved = false)
        val gateway = GoTrueNormalAuthGateway(disabled)
        val error = runCatching { gateway.signIn("owner@gmail.com", "synthetic-password") }.exceptionOrNull()
        assertTrue(error is IllegalStateException)
        assertFalse(error is AuthFailure)
    }
}
