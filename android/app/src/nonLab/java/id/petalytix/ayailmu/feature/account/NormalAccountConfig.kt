package id.petalytix.ayailmu.feature.account

import java.net.URI
import java.util.Locale
import java.security.MessageDigest

/** Release opt-in is compiled only from explicit build properties. Nothing here contains an endpoint or credential. */
internal data class NormalAccountConfig(val enabled: Boolean, val publicOrigin: String, val syncPolicyVersion: String, val ownerDeclarationVersion: String = "adult-owner-v1", val registrySourceCommit: String = "0".repeat(40), val requiredOrigin: String = "") {
    val authOrigin: String get() = publicOrigin
    val apiOrigin: String get() = publicOrigin
    val environmentHash: String by lazy {
        MessageDigest.getInstance("SHA-256").digest(publicOrigin.toByteArray(Charsets.US_ASCII))
            .joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    }

    companion object {
        fun forValues(approved: Boolean, publicOrigin: String, syncPolicyVersion: String, ownerDeclarationVersion: String = "adult-owner-v1", registrySourceCommit: String = "0".repeat(40), requiredOrigin: String = ""): NormalAccountConfig {
            val origin = publicOrigin.trim()
            val uri = runCatching { URI(origin) }.getOrNull()
            val canonical = uri != null && uri.scheme == "https" && !uri.host.isNullOrEmpty() &&
                uri.host == uri.host.lowercase(Locale.ROOT) && uri.rawUserInfo == null &&
                uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.isNullOrEmpty() &&
                (uri.port == -1 || uri.port in 1..65535) &&
                uri.rawAuthority == uri.host + if (uri.port == -1) "" else ":${uri.port}"
            val policy = syncPolicyVersion.trim()
            return NormalAccountConfig(
                enabled = approved && canonical && (requiredOrigin.isEmpty() || publicOrigin == requiredOrigin) && policy.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")) && ownerDeclarationVersion.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")) && registrySourceCommit.matches(Regex("[0-9a-f]{40}")),
                publicOrigin = if (canonical) origin else "",
                syncPolicyVersion = policy,
                ownerDeclarationVersion = ownerDeclarationVersion,
                registrySourceCommit = registrySourceCommit,
                requiredOrigin = requiredOrigin,
            )
        }
    }
}

internal object NormalInput {
    fun email(raw: String): Boolean {
        val value = raw.trim()
        if (value.length > 254 || value.count { it == '@' } != 1 || value.any { it.isWhitespace() || it.isISOControl() }) return false
        val local = value.substringBefore('@')
        val domain = value.substringAfter('@')
        return local.length in 1..64 && !local.startsWith('.') && !local.endsWith('.') && ".." !in local &&
            local.all { it.isLetterOrDigit() || it in ".!#$%&'*+/=?^_`{|}~-" } &&
            domain.length in 3..253 && domain.split('.').size >= 2 && domain.split('.').all { label ->
                label.length in 1..63 && label.first().isLetterOrDigit() && label.last().isLetterOrDigit() && label.all { it.isLetterOrDigit() || it == '-' }
            }
    }
    fun password(value: String) = value.length in 12..256 && value.none { it == '\u0000' || it == '\r' || it == '\n' }
    fun code(value: String) = value.length == 6 && value.all { it in '0'..'9' }
}
