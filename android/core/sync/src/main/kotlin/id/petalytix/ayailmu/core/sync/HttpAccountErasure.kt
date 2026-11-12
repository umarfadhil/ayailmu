package id.petalytix.ayailmu.core.sync

import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okhttp3.RequestBody.Companion.toRequestBody

/** Owned native transport: no ambient cookies, redirects, caches, authenticators or automatic retries. */
class HttpAccountErasure internal constructor(origin: String, source: OkHttpClient) : AccountErasureApi {
    constructor(origin: String) : this(origin, OkHttpClient())
    private val base = URI(origin.removeSuffix("/"))
    private val client = source.newBuilder()
        .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).cache(null)
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).writeTimeout(5, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS).build()
    init {
        require(base.scheme == "https" && !base.host.isNullOrBlank() && base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null && base.rawPath.isNullOrEmpty())
        require(base.port == -1 || base.port in 1..65535)
    }
    override suspend fun begin(token: String, accountId: String, requestId: String, recoveryProof: String): AccountDeletionReceipt {
        require(token.isNotBlank() && token.length <= 16_384 && token.all { it.code in 33..126 })
        require(accountErasureUUID(accountId))
        return requireNotNull(request(false, token, requestId, recoveryProof, buildJsonObject {
            put("account_id", accountId); put("request_id", requestId); put("recovery_token", recoveryProof); put("confirmed", true)
        }))
    }
    override suspend fun status(requestId: String, recoveryProof: String): AccountDeletionReceipt? = request(true, null, requestId, recoveryProof, buildJsonObject {
        put("request_id", requestId); put("recovery_token", recoveryProof)
    })
    private suspend fun request(statusOnly: Boolean, token: String?, requestId: String, proof: String, body: JsonObject): AccountDeletionReceipt? = withContext(Dispatchers.IO) {
        require(accountErasureUUID(requestId) && accountErasureProof(proof))
        val path = "/v1/account/deletion" + if (statusOnly) "/status" else ""
        val encoded = body.toString().toRequestBody("application/json".toMediaType())
        // Retry-After: 0 on 503 can otherwise retry even with retryOnConnectionFailure(false).
        val once = object : RequestBody() {
            override fun contentType() = encoded.contentType()
            override fun contentLength() = encoded.contentLength()
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) = encoded.writeTo(sink)
        }
        val request = Request.Builder().url(base.toString() + path)
            .header("Accept", "application/json").header("Accept-Encoding", "identity")
            .post(once)
        if (token != null) request.header("Authorization", "Bearer $token")
        try {
            client.newCall(request.build()).execute().use { response ->
                if (statusOnly && response.code == 404) return@withContext null
                val sourceBody = requireNotNull(response.body).source()
                if (sourceBody.request(4097)) throw IOException("Account erasure response too large")
                val raw = sourceBody.readByteArray()
                if (response.code !in if (statusOnly) setOf(200) else setOf(200, 202)) {
                    // Do not surface provider text, credentials or URLs. Anonymous recovery never asks for Auth.
                    val error = runCatching {
                        val fields = Json.parseToJsonElement(raw.decodeToString(throwOnInvalidSequence = true)).jsonObject
                        fields["error"]?.jsonPrimitive?.takeIf { fields.keys == setOf("error") && it.isString }?.content
                    }.getOrNull()
                    val code = when {
                        !statusOnly && response.code == 401 -> "unauthorized"
                        !statusOnly && response.code == 403 && error in setOf("fresh_authentication_required", "fresh_auth_required") -> "fresh_authentication_required"
                        else -> "account_erasure_unconfirmed"
                    }
                    throw ApiFailure(response.code, code)
                }
                val receipt = Json.decodeFromString<AccountDeletionReceipt>(raw.decodeToString(throwOnInvalidSequence = true))
                receipt.requireValid(requestId)
                require(statusOnly || response.code == if (receipt.completed) 200 else 202)
                receipt
            }
        } catch (e: ApiFailure) { throw e } catch (_: Exception) {
            throw IOException("Account erasure could not be confirmed")
        }
    }
}
