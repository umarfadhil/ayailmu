package id.petalytix.ayailmu.feature.synclab

import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.junit.Test

class SyncLabEndpointsTest {
    @Test
    fun localDefaultStaysOnLoopback() {
        val endpoints = SyncLabEndpoints.forPublicOrigin("")
        assertEquals("http://127.0.0.1:8187", endpoints.api)
        assertEquals("http://127.0.0.1:8287", endpoints.auth)
        assertEquals(endpoints.auth, endpoints.issuer)
    }

    @Test
    fun publicOriginDrivesBothClientsAndIssuer() {
        val origin = "https://umar-test.example.invalid"
        val endpoints = SyncLabEndpoints.forPublicOrigin(origin)
        assertEquals(origin, endpoints.api)
        assertEquals(origin, endpoints.auth)
        assertEquals(origin, endpoints.issuer)
    }

    @Test
    fun publicOriginRejectsUnsafeOrNonCanonicalValues() {
        listOf(
            "http://umar-test.example.invalid",
            "http://127.0.0.1:8187",
            " https://umar-test.example.invalid",
            "https://umar-test.example.invalid\n",
            "https://user:password@umar-test.example.invalid",
            "https://umar-test.example.invalid/",
            "https://umar-test.example.invalid/auth",
            "https://umar-test.example.invalid?token=x",
            "https://umar-test.example.invalid#fragment",
            "https://UMAR-test.example.invalid",
            "https://umar-test.example.invalid:0",
            "https://umar-test.example.invalid:65536",
            "https:///missing-host",
            "javascript:alert(1)",
        ).forEach { origin ->
            assertFailsWith<IllegalArgumentException>(origin) { SyncLabEndpoints.forPublicOrigin(origin) }
        }
    }
}
