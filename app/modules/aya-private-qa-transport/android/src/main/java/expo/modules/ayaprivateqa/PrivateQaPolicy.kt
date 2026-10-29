package expo.modules.ayaprivateqa

import android.content.Context
import android.util.JsonReader
import android.util.JsonToken
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.StringReader
import java.net.Proxy
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

// Single-use network-attempt gate carried as a typed request tag. Request.newBuilder keeps
// tags, so OkHttp's internal follow-ups (e.g. 503 Retry-After: 0) find the gate already used.
internal class PrivateQaAttempt {
  val used = AtomicBoolean(false)
}

// Bounded private-QA policy. Loads only the generated public CA and binding from the app's
// assets, validates requests, and builds a dedicated OkHttp client that trusts that single
// anchor with OkHttp's default hostname verifier. It never touches global trust, logs,
// creates certificates, or performs network calls itself.
internal class PrivateQaPolicy private constructor(
  private val cert: X509Certificate,
  private val caSha256: String,
) {
  data class Prepared(val id: String, val originalUrl: String, val request: Request)

  fun binding(): Map<String, Any>? {
    if (!valid(cert)) return null
    return Collections.unmodifiableMap(
      linkedMapOf<String, Any>("enabled" to true, "apiOrigin" to API_ORIGIN, "authOrigin" to AUTH_ORIGIN, "caSha256" to caSha256)
    )
  }

  fun client(): OkHttpClient? {
    try {
      if (!valid(cert)) return null
      val store = KeyStore.getInstance(KeyStore.getDefaultType())
      store.load(null, null)
      store.setCertificateEntry("aya-private-qa-ca", cert)
      val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
      factory.init(store)
      val trust = factory.trustManagers.singleOrNull() as? X509TrustManager ?: return null
      val context = SSLContext.getInstance("TLS")
      context.init(null, arrayOf(trust), null)
      return OkHttpClient.Builder()
        .sslSocketFactory(context.socketFactory, trust)
        .proxy(Proxy.NO_PROXY)
        .cookieJar(CookieJar.NO_COOKIES)
        .cache(null)
        .authenticator(Authenticator.NONE)
        .proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .addNetworkInterceptor(oneAttemptInterceptor())
        .callTimeout(10, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()
    } catch (_: Exception) {
      return null
    }
  }

  companion object {
    const val API_ORIGIN = "https://localhost:58444"
    const val AUTH_ORIGIN = "https://localhost:58445"

    private const val CA_ASSET = "aya-private-qa-ca.der"
    private const val BINDING_ASSET = "aya-private-qa-binding.json"
    private const val MAX_DER_BYTES = 64 * 1024
    private const val MAX_BINDING_BYTES = 16 * 1024
    private const val MAX_URL_BYTES = 8192
    private const val MAX_HEADER_COUNT = 64
    private const val MAX_HEADER_FIELD_BYTES = 8192
    private const val MAX_HEADER_TOTAL_BYTES = 32768
    private const val MAX_BODY_BYTES = 2 * 1024 * 1024
    private val BINDING_KEYS = setOf("enabled", "apiOrigin", "authOrigin", "caSha256")
    private val REQUEST_KEYS = setOf("id", "url", "method", "headers", "body")
    private const val ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-"
    private const val TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-.^_`|~"
    private const val LOWER_HEX = "0123456789abcdef"
    private const val ANY_HEX = "0123456789abcdefABCDEF"
    // OkHttp refuses a null body for these; they get an empty one, never invented JSON.
    private val BODY_REQUIRED = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

    fun load(context: Context): PrivateQaPolicy? {
      try {
        val der = readAsset(context, CA_ASSET, MAX_DER_BYTES) ?: return null
        val bindingBytes = readAsset(context, BINDING_ASSET, MAX_BINDING_BYTES) ?: return null
        val hash = parseBinding(bindingBytes) ?: return null
        val digest = MessageDigest.getInstance("SHA-256").digest(der)
        if (digest.joinToString("") { "%02x".format(it.toInt() and 0xff) } != hash) return null
        val cert = CertificateFactory.getInstance("X.509")
          .generateCertificate(ByteArrayInputStream(der)) as? X509Certificate ?: return null
        if (!cert.encoded.contentEquals(der) || cert.basicConstraints < 0 || !valid(cert)) return null
        return PrivateQaPolicy(cert, hash)
      } catch (_: Exception) {
        return null
      }
    }

    fun urlAllowed(raw: String): Boolean {
      if (raw.isEmpty() || raw.length > MAX_URL_BYTES ||
        raw.any { it < '!' || it > '~' || it == '#' || it == '\\' }) return false
      val (origin, port) = when {
        raw.startsWith(API_ORIGIN) -> API_ORIGIN to 58444
        raw.startsWith(AUTH_ORIGIN) -> AUTH_ORIGIN to 58445
        else -> return false
      }
      val rest = raw.substring(origin.length)
      if (rest.isNotEmpty() && rest[0] != '/' && rest[0] != '?') return false
      return try {
        val uri = URI(raw)
        !uri.isOpaque && uri.scheme == "https" && uri.host == "localhost" && uri.port == port &&
          uri.rawAuthority == "localhost:$port" && uri.rawUserInfo == null && uri.rawFragment == null &&
          uri.toASCIIString() == raw
      } catch (_: Exception) {
        false
      }
    }

    fun prepare(input: Map<String, Any?>): Prepared? {
      if (input.keys != REQUEST_KEYS) return null
      val id = input["id"] as? String ?: return null
      if (id.isEmpty() || id.length > 128 || !id.all { it in ID_CHARS }) return null
      val raw = input["url"] as? String ?: return null
      if (!urlAllowed(raw)) return null
      val method = input["method"] as? String ?: return null
      if (method.isEmpty() || method.length > 16 || !method.all { it in 'A'..'Z' }) return null
      val headers = input["headers"] as? Map<*, *> ?: return null
      if (headers.size > MAX_HEADER_COUNT) return null

      val checked = ArrayList<Pair<String, String>>(headers.size)
      val seen = HashSet<String>()
      var total = 0
      for ((name, value) in headers) {
        if (name !is String || value !is String) return null
        val lower = name.lowercase()
        val valueBytes = value.toByteArray(Charsets.UTF_8).size
        total += name.length + valueBytes
        if (name.isEmpty() || name.length > MAX_HEADER_FIELD_BYTES || valueBytes > MAX_HEADER_FIELD_BYTES ||
          !name.all { it in TOKEN_CHARS } || value.any { it == '\r' || it == '\n' || it == '\u0000' } ||
          lower == "host" || lower == "cookie" || !seen.add(lower)) return null
        checked.add(name to value)
      }
      if (total > MAX_HEADER_TOTAL_BYTES) return null

      val body: RequestBody? = when (val text = input["body"]) {
        null -> if (method in BODY_REQUIRED) ByteArray(0).toRequestBody(null) else null
        is String -> {
          if (method == "GET" || method == "HEAD" || text.length > MAX_BODY_BYTES) return null
          val bytes = text.toByteArray(Charsets.UTF_8)
          if (bytes.size > MAX_BODY_BYTES || !strictJson(text)) return null
          bytes.toRequestBody(null)
        }
        else -> return null
      }

      return try {
        val builder = Request.Builder().url(raw).method(method, body)
        for ((name, value) in checked) builder.header(name, value)
        val request = withOneAttempt(builder.build())
        val url = request.url
        if (!url.isHttps || url.host != "localhost" || url.port != URI(raw).port ||
          url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) return null
        Prepared(id, raw, request)
      } catch (_: Exception) {
        null
      }
    }

    fun withOneAttempt(request: Request): Request =
      request.newBuilder().tag(PrivateQaAttempt::class.java, PrivateQaAttempt()).build()

    // Refuses before any HTTP write unless the request carries an unused gate.
    fun oneAttemptInterceptor(): Interceptor = object : Interceptor {
      override fun intercept(chain: Interceptor.Chain): Response {
        val gate = chain.request().tag(PrivateQaAttempt::class.java)
        if (gate == null || !gate.used.compareAndSet(false, true)) throw IOException("Private QA request failed")
        return chain.proceed(chain.request())
      }
    }

    private fun valid(cert: X509Certificate): Boolean =
      try {
        cert.checkValidity()
        true
      } catch (_: Exception) {
        false
      }

    private fun readAsset(context: Context, name: String, max: Int): ByteArray? {
      context.assets.open(name).use { input ->
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          out.write(buffer, 0, count)
          if (out.size() > max) return null
        }
        return out.toByteArray().takeIf { it.isNotEmpty() }
      }
    }

    // The binding's caSha256 when the JSON is exactly the four expected keys, else null.
    private fun parseBinding(bytes: ByteArray): String? {
      val text = String(bytes, Charsets.UTF_8)
      if (!stringsStrict(text)) return null
      JsonReader(StringReader(text)).use { reader ->
        reader.isLenient = false
        val seen = HashSet<String>()
        var hash: String? = null
        reader.beginObject()
        while (reader.hasNext()) {
          val key = reader.nextName()
          if (!seen.add(key)) return null
          val kind = reader.peek()
          when (key) {
            "enabled" -> if (kind != JsonToken.BOOLEAN || !reader.nextBoolean()) return null
            "apiOrigin" -> if (kind != JsonToken.STRING || reader.nextString() != API_ORIGIN) return null
            "authOrigin" -> if (kind != JsonToken.STRING || reader.nextString() != AUTH_ORIGIN) return null
            "caSha256" -> if (kind != JsonToken.STRING) return null else hash = reader.nextString()
            else -> return null
          }
        }
        reader.endObject()
        if (reader.peek() != JsonToken.END_DOCUMENT || seen != BINDING_KEYS) return null
        return hash?.takeIf { it.length == 64 && it.all { c -> c in LOWER_HEX } }
      }
    }

    // One strict JSON value of any kind: the strict reader only accepts a document that is an
    // array or object, so the text is wrapped and must be exactly one element followed by EOF.
    private fun strictJson(text: String): Boolean {
      if (!stringsStrict(text)) return false
      return try {
        JsonReader(StringReader("[$text]")).use { reader ->
          reader.isLenient = false
          reader.beginArray()
          if (!reader.hasNext()) return false
          reader.skipValue()
          reader.endArray()
          reader.peek() == JsonToken.END_DOCUMENT
        }
      } catch (_: Exception) {
        false
      }
    }

    // JsonReader tolerates raw control characters and unknown escapes inside strings; JSON does not.
    private fun stringsStrict(text: String): Boolean {
      var inString = false
      var i = 0
      while (i < text.length) {
        val c = text[i]
        if (!inString) {
          if (c == '"') inString = true
        } else if (c == '"') {
          inString = false
        } else if (c < ' ') {
          return false
        } else if (c == '\\') {
          i += 1
          val escaped = text.getOrNull(i) ?: return false
          if (escaped == 'u') {
            if (i + 4 >= text.length || (1..4).any { text[i + it] !in ANY_HEX }) return false
            i += 4
          } else if (escaped !in "\"\\/bfnrt") {
            return false
          }
        }
        i += 1
      }
      return true
    }
  }
}
