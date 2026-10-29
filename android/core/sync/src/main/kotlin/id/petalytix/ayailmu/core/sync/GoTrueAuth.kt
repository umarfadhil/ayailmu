package id.petalytix.ayailmu.core.sync

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class AuthUser(val id: String, val email: String = "", @SerialName("email_confirmed_at") val emailConfirmedAt: String? = null)

@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("token_type") val tokenType: String,
    val user: AuthUser,
) {
    override fun toString() = "AuthSession(redacted)"
}

class AuthFailure(val status: Int, val code: String) : RuntimeException("Authentication HTTP $status: $code")

/** Documented GoTrue v2 HTTP adapter. The provider owns credentials, OTPs and tokens;
 * this app does not issue/verify tokens or implement password cryptography. No logging. */
class GoTrueAuth(baseUrl: String, private val googleRedirectScheme: String = "id.petalytix.ayailmu.synclab") {
    private val base = URI(baseUrl.trimEnd('/'))
    private val json = Json { ignoreUnknownKeys = true }
    init {
        require(googleRedirectScheme.matches(Regex("[a-z][a-z0-9+.-]{2,63}")))
        require(base.host != null && base.userInfo == null && base.query == null && base.fragment == null && base.path.isNullOrEmpty())
        require(base.scheme == "https" || base.scheme == "http" && base.host in setOf("127.0.0.1", "localhost"))
    }
    private suspend fun request(method: String, path: String, body: JsonObject? = null, token: String? = null): JsonElement = withContext(Dispatchers.IO) {
        require(token == null || token.isNotBlank() && token.length <= 16_384 && '\n' !in token && '\r' !in token)
        val url = URI(base.toString() + path).toURL()
        val connection = (if (base.host in setOf("127.0.0.1", "localhost")) url.openConnection(Proxy.NO_PROXY) else url.openConnection()) as HttpURLConnection
        try {
            connection.requestMethod = method; connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000; connection.readTimeout = 5_000
            connection.setRequestProperty("Accept", "application/json")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                val bytes = body.toString().encodeToByteArray(); require(bytes.size <= 16_384)
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (out.size() <= 1_048_576) {
                    val n = input.read(buffer, 0, minOf(buffer.size, 1_048_577 - out.size()))
                    if (n == -1) break
                    out.write(buffer, 0, n)
                }; out.toByteArray()
            } ?: byteArrayOf()
            require(bytes.size <= 1_048_576) { "Authentication response too large" }
            val value = runCatching { if (bytes.isEmpty()) JsonNull else json.parseToJsonElement(bytes.decodeToString()) }.getOrNull()
            if (status !in 200..299) {
                val code = (value as? JsonObject)?.get("error_code")?.jsonPrimitive?.content
                throw AuthFailure(status, code?.takeIf { it.matches(Regex("[a-z_]{1,80}")) } ?: "request_failed")
            }
            value ?: error("Invalid authentication response")
        } finally { connection.disconnect() }
    }
    private fun identity(email: String) { require(email.length <= 254 && email.contains('@') && email.none { it.isWhitespace() }) }
    private fun password(value: String) { require(value.length in 12..256) }
    private fun session(value: JsonElement): AuthSession = json.decodeFromJsonElement<AuthSession>(value).also {
        require(it.accessToken.isNotBlank() && it.accessToken.length <= 16_384 && it.refreshToken.isNotBlank() && it.refreshToken.length <= 4096 && it.tokenType.equals("bearer", true) && it.expiresIn in 1..86_400 && it.user.id.isNotBlank())
    }
    suspend fun signUp(email: String, password: String) {
        identity(email); password(password)
        request("POST", "/signup", buildJsonObject { put("email", email); put("password", password) })
    }
    suspend fun signIn(email: String, password: String): AuthSession {
        identity(email); password(password)
        return session(request("POST", "/token?grant_type=password", buildJsonObject { put("email", email); put("password", password) }))
    }
    suspend fun verifyOtp(email: String, code: String, type: String): AuthSession {
        identity(email); require(code.matches(Regex("[0-9]{6}")) && type in setOf("signup", "recovery"))
        return session(request("POST", "/verify", buildJsonObject { put("email", email); put("token", code); put("type", type) }))
    }
    suspend fun recover(email: String) { identity(email); request("POST", "/recover", buildJsonObject { put("email", email) }) }
    suspend fun resend(email: String) { identity(email); request("POST", "/resend", buildJsonObject { put("email", email); put("type", "signup") }) }
    suspend fun refresh(refreshToken: String): AuthSession {
        require(refreshToken.isNotBlank() && refreshToken.length <= 4096)
        return session(request("POST", "/token?grant_type=refresh_token", buildJsonObject { put("refresh_token", refreshToken) }))
    }
    suspend fun user(token: String): AuthUser = json.decodeFromJsonElement(request("GET", "/user", token = token))
    suspend fun updatePassword(token: String, password: String): AuthUser {
        password(password)
        return json.decodeFromJsonElement(request("PUT", "/user", buildJsonObject { put("password", password) }, token))
    }
    suspend fun signOut(token: String) { request("POST", "/logout?scope=local", token = token) }
    fun googleUrl(challenge: String, redirect: String): String {
        require(challenge.matches(Regex("[A-Za-z0-9_-]{16,128}")))
        val uri = URI(redirect)
        require(uri.scheme == googleRedirectScheme && uri.host == "auth-callback" && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.matches(Regex("/[A-Za-z0-9_-]{4,128}")))
        fun encode(s: String) = URLEncoder.encode(s, "UTF-8")
        return "$base/authorize?provider=google&redirect_to=${encode(redirect)}&code_challenge=${encode(challenge)}&code_challenge_method=s256"
    }
    suspend fun exchangeCode(code: String, verifier: String): AuthSession {
        require(code.isNotBlank() && code.length <= 4096 && verifier.matches(Regex("[A-Za-z0-9._~-]{43,128}")))
        return session(request("POST", "/token?grant_type=pkce", buildJsonObject { put("auth_code", code); put("code_verifier", verifier) }))
    }
}
