package id.petalytix.ayailmu.core.sync

import java.net.CookieHandler
import java.net.CookieManager
import java.net.HttpCookie
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Test

class AccountErasureTransportTest {
    private val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
    private val request = "11111111-1111-4111-8111-111111111111"
    private val owner = "22222222-2222-4222-8222-222222222222"
    private val proof = "a".repeat(64)
    private val pending = """{"deletion_id":"33333333-3333-4333-8333-333333333333","scope":"account","request_id":"$request","status":"identity_deletion_pending","app_data_erased_at":"2026-11-11T10:00:00Z"}"""
    @Test fun strictReceiptRejectsDuplicateUnknownNullAndWrongStates() {
        val receipt = Json.decodeFromString<AccountDeletionReceipt>(pending)
        assertFalse(receipt.completed)
        val invalid = listOf(
            pending.dropLast(1) + ",\"scope\":\"account\"}",
            pending.dropLast(1) + ",\"email\":\"secret\"}",
            pending.dropLast(1) + ",\"identity_deleted_at\":null}",
            pending.replace("identity_deletion_pending", "completed"),
            pending.replace("33333333-3333-4333-8333-333333333333", "00000000-0000-0000-0000-000000000000"),
            pending.replace("\"scope\":\"account\"", "\"scope\":true"),
            pending.replace("identity_deletion_pending", "completed").dropLast(1) + ",\"identity_deleted_at\":\"2026-11-10T10:00:00Z\"}",
        )
        invalid.forEach { assertFails { Json.decodeFromString<AccountDeletionReceipt>(it) } }
        assertFails { receipt.requireValid(owner) }
        val complete = pending.replace("identity_deletion_pending", "completed").dropLast(1) + ",\"identity_deleted_at\":\"2026-11-11T10:00:01Z\"}"
        assertTrue(Json.decodeFromString<AccountDeletionReceipt>(complete).completed)
    }
    private fun fixture(block: suspend (MockWebServer, HttpAccountErasure) -> Unit) = runTest {
        val cert = certificate
        val serverTLS = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTLS = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        MockWebServer().use { server ->
            server.useHttps(serverTLS.sslSocketFactory(), false)
            server.start()
            val client = OkHttpClient.Builder().sslSocketFactory(clientTLS.sslSocketFactory(), clientTLS.trustManager).build()
            block(server, HttpAccountErasure(server.url("/").toString(), client))
        }
    }
    @Test fun statusIsProofOnlyAndIgnoresAmbientCookies() = fixture { server, api ->
        val previous = CookieHandler.getDefault()
        try {
            val cookies = CookieManager()
            cookies.cookieStore.add(URI(server.url("/").toString()), HttpCookie("session", "never-send"))
            CookieHandler.setDefault(cookies)
            server.enqueue(MockResponse().setResponseCode(200).setBody(pending).addHeader("Set-Cookie", "session=never-retain"))
            assertNotNull(api.status(request, proof))
            val sent = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("/v1/account/deletion/status", sent.path)
            assertNull(sent.headers["Authorization"])
            assertNull(sent.headers["Cookie"])
            assertEquals(setOf("request_id", "recovery_token"), Json.parseToJsonElement(sent.body.readUtf8()).let { (it as kotlinx.serialization.json.JsonObject).keys })
            server.enqueue(MockResponse().setResponseCode(202).setBody(pending))
            api.begin("bearer", owner, request, proof)
            val begin = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("Bearer bearer", begin.headers["Authorization"])
            assertNull(begin.headers["Cookie"])
        } finally { CookieHandler.setDefault(previous) }
    }
    @Test fun allRedirectsFailForBeginAndStatusBeforeSameOrOtherOriginReceivesProof() = fixture { server, api ->
        val cert = certificate
        MockWebServer().use { trap ->
            trap.useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(), false)
            trap.start()
            for (code in listOf(301, 302, 303, 307, 308)) {
                for (destination in listOf(server.url("/same-origin-trap"), trap.url("/other-origin-trap"))) {
                    for (statusOnly in listOf(true, false)) {
                        server.enqueue(MockResponse().setResponseCode(code).addHeader("Location", destination))
                        assertFails { if (statusOnly) api.status(request, proof) else api.begin("bearer", owner, request, proof) }
                        val sent = server.takeRequest(2, TimeUnit.SECONDS)!!
                        assertEquals(if (statusOnly) "/v1/account/deletion/status" else "/v1/account/deletion", sent.path)
                        assertEquals(if (statusOnly) null else "Bearer bearer", sent.getHeader("Authorization"))
                        assertNull(server.takeRequest(10, TimeUnit.MILLISECONDS))
                    }
                }
            }
            assertEquals(0, trap.requestCount)
        }
    }
    @Test fun serviceUnavailableCannotAutomaticallyReplayCredentialBody() = fixture { server, api ->
        for (statusOnly in listOf(true, false)) {
            server.enqueue(MockResponse().setResponseCode(503).addHeader("Retry-After", "0"))
            val failure = assertFailsWith<ApiFailure> { if (statusOnly) api.status(request, proof) else api.begin("bearer", owner, request, proof) }
            assertEquals(503, failure.status)
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            assertNull(server.takeRequest(10, TimeUnit.MILLISECONDS))
        }
    }
    @Test fun onlyAuthenticatedFreshAuthErrorSuggestsSigningInAgain() = fixture { server, api ->
        for ((statusOnly, body, expected) in listOf(
            Triple(false, "{\"error\":\"fresh_authentication_required\"}", "fresh_authentication_required"),
            Triple(false, "{\"error\":\"forbidden\"}", "account_erasure_unconfirmed"),
            Triple(true, "{\"error\":\"fresh_authentication_required\"}", "account_erasure_unconfirmed"),
        )) {
            server.enqueue(MockResponse().setResponseCode(403).setBody(body))
            val failure = assertFailsWith<ApiFailure> { if (statusOnly) api.status(request, proof) else api.begin("bearer", owner, request, proof) }
            assertEquals(expected, failure.code)
        }
    }
    @Test fun only404MeansUnregisteredAndBodiesAreBounded() = fixture { server, api ->
        server.enqueue(MockResponse().setResponseCode(404).setBody("{}"))
        assertNull(api.status(request, proof))
        for ((code, body) in listOf(503 to "{}", 200 to "x".repeat(4097), 200 to pending.replace(request, owner), 202 to pending)) {
            server.enqueue(MockResponse().setResponseCode(code).setBody(body))
            assertFails { api.status(request, proof) }
        }
    }
}
