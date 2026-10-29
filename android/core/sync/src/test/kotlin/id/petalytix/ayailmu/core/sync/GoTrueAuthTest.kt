package id.petalytix.ayailmu.core.sync

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Test

class GoTrueAuthTest {
    private val response = """{"access_token":"synthetic-access-opaque","refresh_token":"synthetic-refresh-opaque","expires_in":60,"token_type":"bearer","user":{"id":"a749d859-937d-408b-a183-7931c8ab58c1","email":"syn-http@example.invalid","email_confirmed_at":"2026-10-19T00:00:00Z"}}"""
    @Test fun emailOtpRefreshAndLogoutUseDocumentedGoTrueContracts() = runTest {
        val calls=mutableListOf<Triple<String,String,JsonObject>>()
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { e ->
            val bytes=e.requestBody.readBytes()
            val body=if(bytes.isEmpty()) JsonObject(emptyMap()) else Json.parseToJsonElement(bytes.decodeToString()).jsonObject
            calls+=Triple(e.requestMethod,e.requestURI.toString(),body)
            if(e.requestURI.path=="/logout") { assertEquals("Bearer synthetic-access-opaque",e.requestHeaders.getFirst("Authorization"));e.sendResponseHeaders(204,-1);e.close() }
            else { val raw=when(e.requestURI.path){ "/signup","/recover","/resend" -> "{}"; "/user" -> Json.parseToJsonElement(response).jsonObject.getValue("user").toString(); else -> response };val b=raw.encodeToByteArray();e.sendResponseHeaders(200,b.size.toLong());e.responseBody.use{it.write(b)} }
        };server.start()
        try {
            val client=GoTrueAuth("http://127.0.0.1:${server.address.port}")
            val password=" synthetic password "
            client.signUp("syn-http@example.invalid",password)
            val login=client.signIn("syn-http@example.invalid",password)
            client.verifyOtp("syn-http@example.invalid","123456","signup")
            client.recover("syn-http@example.invalid")
            client.verifyOtp("syn-http@example.invalid","654321","recovery")
            client.refresh(login.refreshToken)
            client.updatePassword(login.accessToken,"new synthetic password")
            client.signOut(login.accessToken)
            assertEquals(password,calls[0].third.getValue("password").jsonPrimitive.content)
            assertEquals("/token?grant_type=password",calls[1].second)
            assertEquals("signup",calls[2].third.getValue("type").jsonPrimitive.content)
            assertEquals("recovery",calls[4].third.getValue("type").jsonPrimitive.content)
            assertEquals("/token?grant_type=refresh_token",calls[5].second)
            assertEquals("PUT",calls[6].first);assertEquals("/logout?scope=local",calls[7].second)
            assertFalse(login.toString().contains(login.accessToken));assertFalse(login.toString().contains(login.refreshToken))
        } finally { server.stop(0) }
    }
    @Test fun googlePreparationHasPkceAndNoGoogleTokensOrSecretsInApp() {
        val api=GoTrueAuth("http://127.0.0.1:8287")
        val uri=URI(api.googleUrl("synthetic-challenge","id.petalytix.ayailmu.synclab://auth-callback/nonce"))
        assertEquals("/authorize",uri.path);assertTrue(uri.query.contains("provider=google"));assertTrue(uri.query.contains("code_challenge_method=s256"))
        assertFalse(uri.query.contains("client_secret"));assertFalse(uri.query.contains("gmail"))
        assertFailsWith<IllegalArgumentException>{GoTrueAuth("http://foreign.invalid")}
    }
    @Test fun providerErrorsAreSafeAndRedirectsNeverCarryCredentials() = runTest {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0);var followed=false
        server.createContext("/token") { e -> e.responseHeaders.add("Location","http://127.0.0.1:${server.address.port}/leak");e.sendResponseHeaders(307,-1);e.close() }
        server.createContext("/leak") { e -> followed=true;e.sendResponseHeaders(200,-1);e.close() };server.start()
        try { val failure=assertFailsWith<AuthFailure>{GoTrueAuth("http://127.0.0.1:${server.address.port}").signIn("syn-http@example.invalid","synthetic password")};assertFalse(followed);assertFalse(failure.message.orEmpty().contains("synthetic password")) } finally {server.stop(0)}
    }
}
