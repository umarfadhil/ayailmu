package id.petalytix.ayailmu.core.sync

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Test

/** No sockets: the real adapter runs against a fake connection boundary. */
class GoTrueAuthTest {
    private val response = """{"access_token":"synthetic-access-opaque","refresh_token":"synthetic-refresh-opaque","expires_in":60,"token_type":"bearer","user":{"id":"a749d859-937d-408b-a183-7931c8ab58c1","email":"syn-http@example.invalid","email_confirmed_at":"2026-10-19T00:00:00Z"}}"""
    private class Connection(url: URL, private val status: Int, private val response: String) : HttpURLConnection(url) {
        val output = ByteArrayOutputStream()
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getOutputStream() = output
        override fun getResponseCode() = status
        override fun getInputStream() = ByteArrayInputStream(response.encodeToByteArray())
        override fun getErrorStream() = ByteArrayInputStream(response.encodeToByteArray())
    }
    @Test fun emailOtpRefreshAndLogoutUseDocumentedGoTrueContracts() = runTest {
        val calls = mutableListOf<Connection>()
        val api = GoTrueAuth("https://auth.example.invalid", connectionFactory = { url, local ->
            assertFalse(local)
            val body = when (url.path) { "/signup", "/resend", "/recover" -> "{}"; "/user" -> Json.parseToJsonElement(response).jsonObject.getValue("user").toString(); else -> response }
            Connection(url, if (url.path == "/logout") 204 else 200, body).also(calls::add)
        })
        val password = " synthetic password "
        api.signUp("syn-http@example.invalid", password, "signup-one")
        val login = api.signIn("syn-http@example.invalid", password)
        api.verifyOtp("syn-http@example.invalid", "123456", "signup")
        api.recover("syn-http@example.invalid", "recovery-one")
        api.verifyOtp("syn-http@example.invalid", "654321", "recovery")
        api.refresh(login.refreshToken)
        api.updatePassword(login.accessToken, "new synthetic password")
        api.signOut(login.accessToken)
        api.resend("syn-http@example.invalid", "resend-one")
        assertEquals(password, Json.parseToJsonElement(calls[0].output.toString()).jsonObject.getValue("password").jsonPrimitive.content)
        assertEquals("signup-one", calls[0].getRequestProperty("X-Request-ID"))
        assertEquals("recovery-one", calls[3].getRequestProperty("X-Request-ID"))
        assertEquals("resend-one", calls[8].getRequestProperty("X-Request-ID"))
        assertNull(calls[1].getRequestProperty("X-Request-ID"))
        assertEquals("grant_type=password", calls[1].url.query)
        assertEquals("signup", Json.parseToJsonElement(calls[2].output.toString()).jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals("recovery", Json.parseToJsonElement(calls[4].output.toString()).jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals("grant_type=refresh_token", calls[5].url.query)
        assertEquals("PUT", calls[6].requestMethod)
        assertEquals("scope=local", calls[7].url.query)
        assertEquals("Bearer synthetic-access-opaque", calls[7].getRequestProperty("Authorization"))
        assertFalse(login.toString().contains(login.accessToken)); assertFalse(login.toString().contains(login.refreshToken))
    }
    @Test fun googlePreparationHasPkceAndNoGoogleTokensOrSecretsInApp() {
        val api = GoTrueAuth("http://127.0.0.1:8287")
        val uri = URI(api.googleUrl("synthetic-challenge", "id.petalytix.ayailmu.synclab://auth-callback/nonce"))
        assertEquals("/authorize", uri.path); assertTrue(uri.query.contains("provider=google")); assertTrue(uri.query.contains("code_challenge_method=s256"))
        assertFalse(uri.query.contains("client_secret")); assertFalse(uri.query.contains("gmail"))
        assertFailsWith<IllegalArgumentException> { GoTrueAuth("http://foreign.invalid") }
    }
    @Test fun providerErrorsAreSafeAndRedirectsNeverCarryCredentials() = runTest {
        val calls = mutableListOf<Connection>()
        val api = GoTrueAuth("https://auth.example.invalid", connectionFactory = { url, _ -> Connection(url, 307, "{}").also(calls::add) })
        val failure = assertFailsWith<AuthFailure> { api.signIn("syn-http@example.invalid", "synthetic password") }
        assertEquals(307, failure.status); assertEquals(1, calls.size); assertFalse(calls.single().instanceFollowRedirects)
        assertFalse(failure.message.orEmpty().contains("synthetic password"))
    }
    @Test fun ingressReplayCodeAndInvalidHeaderAreHandledWithoutExtraAttempt() = runTest {
        var calls = 0
        val api = GoTrueAuth("https://auth.example.invalid", connectionFactory = { url, _ -> calls++; Connection(url, 409, """{"error":"request_already_attempted"}""") })
        val failure = assertFailsWith<AuthFailure> { api.recover("syn-http@example.invalid", "stable-request") }
        assertEquals("request_already_attempted", failure.code); assertEquals(1, calls)
        assertFailsWith<IllegalArgumentException> { api.recover("syn-http@example.invalid", "bad\r\nX-Evil: value") }
        assertEquals(1, calls)
    }
}
