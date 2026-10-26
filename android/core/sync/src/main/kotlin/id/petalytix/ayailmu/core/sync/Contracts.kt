package id.petalytix.ayailmu.core.sync

import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.engine.RuleConfig
import java.security.MessageDigest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Learner(val id: String, @SerialName("client_learner_id") val clientLearnerId: String, val kind: String, val audience: String, val lang: String, @SerialName("created_by") val createdBy: String = "")
@Serializable
data class Receipt(@SerialName("answer_id") val answerId: String, val sequence: Long, val duplicate: Boolean, @SerialName("registry_status") val registryStatus: String)
@Serializable
data class RemoteRecord(val sequence: Long, val payload: String, @SerialName("registry_status") val registryStatus: String)
@Serializable
data class Page(val events: List<RemoteRecord>, @SerialName("next_cursor") val nextCursor: Long, @SerialName("has_more") val hasMore: Boolean)
@Serializable
data class Catalog(@SerialName("source_commit") val sourceCommit: String, val packs: List<CatalogPack>)
@Serializable
data class CatalogPack(val track: String, @SerialName("content_version") val contentVersion: String, @SerialName("rules_version") val rulesVersion: String, @SerialName("sha256") val packSha256: String, @SerialName("rules_sha256") val rulesSha256: String)
@Serializable
data class PackProof(val track: String, val contentVersion: String, val rulesVersion: String, val packSha256: String, val rulesSha256: String, val sourceCommit: String) {
    fun verify(catalog: Catalog) {
        require(catalog.sourceCommit == sourceCommit) { "Content source mismatch" }
        val p = catalog.packs.singleOrNull { it.track == track && it.contentVersion == contentVersion }
        require(p != null && p.rulesVersion == rulesVersion && p.packSha256 == packSha256 && p.rulesSha256 == rulesSha256) { "Pack/rules provenance mismatch" }
    }
    companion object {
        fun fromBytes(pack: ByteArray, rules: ByteArray, sourceCommit: String): PackProof {
            val p = PackLoader.parse(pack.decodeToString())
            val r = RuleConfig.parse(rules.decodeToString())
            require(p.meta.track == r.track)
            fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
            return PackProof(p.meta.track, p.meta.contentVersion, r.rulesVersion, sha(pack), sha(rules), sourceCommit)
        }
    }
}

interface Backend {
    suspend fun account(token: String): String
    suspend fun currentAccount(token: String): String
    suspend fun learners(token: String): List<Learner>
    suspend fun createLearner(token: String, clientId: String): Learner
    /** Normal owner/guardian profile contract. Synthetic implementations may keep only the lab method. */
    suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String): Learner =
        throw UnsupportedOperationException("Normal learner creation is not configured")
    /** Normal mode must receive the actual owner declaration; there is deliberately no synthetic fallback. */
    suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean): String =
        throw UnsupportedOperationException("Normal owner activation is not configured")
    suspend fun catalog(token: String): Catalog
    suspend fun consent(token: String, learnerId: String, granted: Boolean)
    suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt>
    suspend fun pull(token: String, learnerId: String, after: Long): Page
}
class ApiFailure(val status: Int, val code: String) : RuntimeException("Backend HTTP $status: $code")
data class NormalOwnerDeclaration(val version: String, val adultConfirmed: Boolean)
enum class SyncResult { SYNCED, OFFLINE, CONSENT_OFF, CONSENT_UPDATE_REQUIRED, FRESH_AUTH_REQUIRED, LOGIN_REQUIRED, BLOCKED, SESSION_CHANGED }
