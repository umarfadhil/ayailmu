package id.petalytix.ayailmu.core.sync

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Test

class HttpBackendTest {
    @Test fun exactPayloadEnvelopeAndAuthorizationUseExistingV1() = runTest {
        var received: JsonObject?=null
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/v1/learners/learner-1/events") { exchange ->
            assertEquals("Bearer synthetic-token",exchange.requestHeaders.getFirst("Authorization"))
            received=Json.parseToJsonElement(exchange.requestBody.readBytes().decodeToString()).jsonObject
            val response="""[{"answer_id":"answer-1","sequence":1,"duplicate":false,"registry_status":"registered"}]""".encodeToByteArray()
            exchange.sendResponseHeaders(200,response.size.toLong());exchange.responseBody.use{it.write(response)}
        };server.start()
        try {
            val raw=""" { "answer_id":"answer-1", "raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}" } """
            val r=HttpBackend("http://127.0.0.1:${server.address.port}").append("synthetic-token","learner-1",listOf(raw))
            assertEquals(1L,r.single().sequence);assertEquals(1,received!!["schema_version"]!!.jsonPrimitive.int)
            assertTrue(received!!["synthetic"]!!.jsonPrimitive.boolean);assertEquals(raw,received!!["events"]!!.jsonArray.single().jsonPrimitive.content)
        } finally {server.stop(0)}
    }
    @Test fun redirectsAreNotFollowedAndUnsafeBaseIsRejected() = runTest {
        assertFailsWith<IllegalArgumentException>{HttpBackend("http://example.com:8186")}
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0);var redirected=false
        server.createContext("/v1/account"){e->e.responseHeaders.add("Location","http://127.0.0.1:${server.address.port}/leak");e.sendResponseHeaders(307,-1);e.close()}
        server.createContext("/leak"){e->redirected=true;e.sendResponseHeaders(200,-1);e.close()};server.start()
        try {assertFailsWith<ApiFailure>{HttpBackend("http://127.0.0.1:${server.address.port}").account("synthetic-token")};assertFalse(redirected)} finally {server.stop(0)}
    }
}

class HttpLearnerErasureTest {
    @Test fun exactConfirmedRequestAndReceiptRejectAmbiguousSuccess() = runTest {
        val learner = "20000000-0000-0000-0000-000000000001"
        val request = "30000000-0000-0000-0000-000000000001"
        var calls = 0
        var extra = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/learners/$learner/deletion") { e ->
            calls++
            assertEquals("POST", e.requestMethod)
            assertEquals("Bearer synthetic-token", e.requestHeaders.getFirst("Authorization"))
            assertEquals(buildJsonObject { put("request_id", request); put("confirmed", true); put("synthetic", true) }, Json.parseToJsonElement(e.requestBody.readBytes().decodeToString()))
            val body = buildJsonObject {
                put("deletion_id", "40000000-0000-0000-0000-000000000001"); put("scope", "learner")
                put("learner_id", learner); put("request_id", request); put("completed_at", "2026-11-11T12:00:00Z")
                if (extra) put("account_deleted", true)
            }.toString().encodeToByteArray()
            e.sendResponseHeaders(200, body.size.toLong()); e.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val api = HttpBackend("http://127.0.0.1:${server.address.port}")
            assertFailsWith<IllegalArgumentException> { api.deleteLearner("synthetic-token", learner, request, false) }
            assertEquals(0, calls)
            assertEquals(request, api.deleteLearner("synthetic-token", learner, request, true).requestId)
            extra = true
            assertFailsWith<IllegalArgumentException> { api.deleteLearner("synthetic-token", learner, request, true) }
        } finally { server.stop(0) }
    }
}
