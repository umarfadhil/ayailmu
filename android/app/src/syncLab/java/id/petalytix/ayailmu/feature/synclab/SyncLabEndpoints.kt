package id.petalytix.ayailmu.feature.synclab

import java.net.URI
import java.util.Locale

/** Synthetic lab only. One exact public origin keeps routing and the provider issuer aligned. */
internal data class SyncLabEndpoints(val api: String, val auth: String, val issuer: String) {
    companion object {
        fun forPublicOrigin(origin: String): SyncLabEndpoints {
            if (origin.isEmpty()) {
                return SyncLabEndpoints("http://127.0.0.1:8187", "http://127.0.0.1:8287", "http://127.0.0.1:8287")
            }
            val uri = runCatching { URI(origin) }.getOrNull()
            require(
                uri != null && uri.scheme == "https" && !uri.host.isNullOrEmpty() &&
                    uri.host == uri.host.lowercase(Locale.ROOT) && uri.rawUserInfo == null &&
                    uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.isNullOrEmpty() &&
                    (uri.port == -1 || uri.port in 1..65535) &&
                    uri.rawAuthority == uri.host + if (uri.port == -1) "" else ":${uri.port}",
            ) { "Synthetic lab public origin must be a canonical HTTPS origin without credentials, path, query or fragment" }
            return SyncLabEndpoints(origin, origin, origin)
        }
    }
}
