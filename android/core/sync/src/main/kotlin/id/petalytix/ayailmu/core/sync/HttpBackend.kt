package id.petalytix.ayailmu.core.sync

import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/** Existing backend v1, with no raw payload rewriting and no redirects carrying bearer credentials. */
class HttpBackend(baseUrl: String) : Backend {
    private val base = URI(baseUrl.trimEnd('/'))
    private val json = Json { ignoreUnknownKeys = true }
    init {
        require(base.userInfo == null && base.query == null && base.fragment == null && (base.path.isNullOrEmpty() || base.path == "/"))
        require(base.scheme == "https" || base.scheme == "http" && base.host in setOf("127.0.0.1", "localhost")) { "HTTP is limited to the local synthetic lab" }
    }
    private suspend inline fun <reified T> request(method: String, path: String, token: String, body: JsonElement? = null): T = withContext(Dispatchers.IO) {
        require(token.isNotBlank() && '\n' !in token && '\r' !in token)
        val url = URI(base.toString() + path).toURL()
        val connection = (if (base.host in setOf("127.0.0.1", "localhost")) url.openConnection(Proxy.NO_PROXY) else url.openConnection()) as HttpURLConnection
        try {
            connection.requestMethod = method; connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000; connection.readTimeout = 5_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                val bytes = body.toString().encodeToByteArray()
                require(bytes.size <= 1_048_576)
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            // InputStream.readNBytes is Android 33+, while the native app supports API 26.
            val bytes = stream?.use { input ->
                val result = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (result.size() <= 4_194_304) {
                    val read = input.read(buffer, 0, minOf(buffer.size, 4_194_305 - result.size()))
                    if (read == -1) break
                    result.write(buffer, 0, read)
                }
                result.toByteArray()
            } ?: byteArrayOf()
            require(bytes.size <= 4_194_304) { "Backend response too large" }
            if (status !in 200..299) {
                val code = runCatching { json.parseToJsonElement(bytes.decodeToString()).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                throw ApiFailure(status, code?.takeIf { it.matches(Regex("[a-z_]{1,80}")) } ?: "request_failed")
            }
            json.decodeFromString<T>(bytes.decodeToString())
        } finally { connection.disconnect() }
    }
    private fun learnerPath(id: String): String { require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))); return "/v1/learners/$id" }
    override suspend fun account(token: String): String = request<JsonObject>("POST", "/v1/account", token, buildJsonObject { put("declaration_version", "adult-owner-v1"); put("adult_confirmed", true); put("synthetic", true) }).getValue("account_id").jsonPrimitive.content
    override suspend fun learners(token: String): List<Learner> = request("GET", "/v1/learners", token)
    override suspend fun createLearner(token: String, clientId: String): Learner = request("POST", "/v1/learners", token, buildJsonObject { put("client_learner_id", clientId); put("kind", "ADULT"); put("lang", "id"); put("synthetic", true) })
    override suspend fun catalog(token: String): Catalog = request("GET", "/v1/packs", token)
    override suspend fun consent(token: String, learnerId: String, granted: Boolean) { request<JsonObject>("POST", learnerPath(learnerId) + "/consent", token, buildJsonObject { put("version", "synthetic-sync-v1"); put("granted", granted); put("synthetic", true) }) }
    override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> = request("POST", learnerPath(learnerId) + "/events", token, buildJsonObject { put("schema_version", 1); put("synthetic", true); put("events", JsonArray(payloads.map(::JsonPrimitive))) })
    override suspend fun pull(token: String, learnerId: String, after: Long): Page = request("GET", learnerPath(learnerId) + "/events?after=$after&limit=100", token)
}
