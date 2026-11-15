package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.sync.AuthFailure
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NormalAccountConfigTest {
    @Test fun productionDefaultDoesNotRequireAPinnedOrigin() {
        val prod = NormalAccountConfig.forValues(true, "https://accounts.petalytix.id", "owner-sync-v1", "adult-owner-v1", "0".repeat(40))
        assertTrue(prod.enabled)
        assertEquals("", prod.requiredOrigin)
    }
    @Test fun disabledGatewayCannotMakeNetworkCalls() = runTest {
        val disabled = NormalAccountConfig.forValues(false, "https://accounts.petalytix.id", "owner-sync-v1")
        val gateway = GoTrueNormalAuthGateway(disabled)
        val error = runCatching { gateway.signIn("owner@gmail.com", "synthetic-password") }.exceptionOrNull()
        assertTrue(error is IllegalStateException)
        assertFalse(error is AuthFailure)
    }
}
