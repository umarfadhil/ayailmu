import groovy.json.JsonOutput
import java.net.URI
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

// Offline public-configuration validation only. Never performs DNS, HTTP, signing or deployment.
val releaseKeys = setOf("format_version", "application_id", "version_name", "version_code", "public_origin",
    "owner_declaration_version", "sync_policy_version", "registry_source_commit", "play_license_public_key",
    "privacy_policy_url", "support_url", "account_deletion_url")
fun rejectRelease(field: String): Nothing = throw GradleException("Invalid public release input: $field")
fun publicURL(value: String, originOnly: Boolean): Boolean {
    val u = runCatching { URI(value) }.getOrNull() ?: return false
    val host = u.host ?: return false
    val labels = host.split('.')
    val forbidden = setOf("localhost", "local", "internal", "invalid", "test", "example", "onion")
    val temporary = listOf("trycloudflare.com", "ngrok.io", "ngrok-free.app", "loca.lt")
    return value.length <= 2048 && value.all { it.code in 33..126 } && u.scheme == "https" &&
        host == host.lowercase() && labels.size >= 2 && host.length <= 253 &&
        labels.all { it.matches(Regex("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")) } &&
        labels.last().matches(Regex("[a-z]{2,63}")) && labels.none { it in forbidden } &&
        listOf("example.com", "example.net", "example.org").none { host == it || host.endsWith(".$it") } &&
        temporary.none { host == it || host.endsWith(".$it") } &&
        u.rawAuthority == host && u.rawUserInfo == null && u.port == -1 && u.rawQuery == null && u.rawFragment == null &&
        (!originOnly || u.rawPath.isNullOrEmpty()) &&
        !u.path.orEmpty().any { it == '\\' || it.isISOControl() } &&
        u.path.orEmpty().split('/').none { it == "." || it == ".." } && u.normalize() == u
}
fun releasePolicy(value: String): Boolean = value.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")) &&
    listOf("qa", "test", "local", "demo", "synthetic", "fixture", "placeholder").none { value == it || value.startsWith("$it-") }

val inputPath = providers.gradleProperty("ayailmu.publicRelease.inputs").orNull
val releaseValues: Map<String, String> = if (inputPath == null) emptyMap() else {
    val source = project.file(inputPath).toPath()
    if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS) || Files.size(source) !in 1..16_384) rejectRelease("file")
    val raw = try {
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .decode(java.nio.ByteBuffer.wrap(Files.readAllBytes(source))).toString()
    } catch (_: Exception) { rejectRelease("file") }
    if (raw.any { it != '\n' && it != '\r' && it.code !in 32..126 }) rejectRelease("file encoding")
    val values = linkedMapOf<String, String>()
    for (rawLine in raw.split('\n')) {
        val line = rawLine.removeSuffix("\r")
        if (line.isEmpty() || line.startsWith("#")) continue
        val at = line.indexOf('=')
        if (at <= 0) rejectRelease("entry format")
        val key = line.substring(0, at)
        val value = line.substring(at + 1)
        if (key !in releaseKeys || values.containsKey(key)) rejectRelease("unknown or duplicate field")
        if (value.isEmpty() || value != value.trim() || value.any { it.code !in 33..126 } || value.contains('\\')) rejectRelease(key)
        values[key] = value
    }
    if (values.keys != releaseKeys) rejectRelease("required fields")
    if (values.getValue("format_version") != "1") rejectRelease("format_version")
    val id = values.getValue("application_id")
    val idLabels = id.split('.')
    if (id.length > 150 || idLabels.size < 3 || !idLabels.all { it.matches(Regex("[a-z][a-z0-9_]*")) } ||
        idLabels.any { it in setOf("example", "demo", "debug", "test", "synclab", "normalqa", "ownerbeta", "local") || it.startsWith("local20") }) rejectRelease("application_id")
    val version = values.getValue("version_name")
    if (version.length > 40 || !version.matches(Regex("(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)")) || version == "0.0.0") rejectRelease("version_name")
    val code = values.getValue("version_code")
    if (!code.matches(Regex("[1-9][0-9]{0,9}")) || code.toLong() > 2_100_000_000L) rejectRelease("version_code")
    if (!publicURL(values.getValue("public_origin"), true)) rejectRelease("public_origin")
    for (key in listOf("privacy_policy_url", "support_url", "account_deletion_url")) if (!publicURL(values.getValue(key), false)) rejectRelease(key)
    for (key in listOf("owner_declaration_version", "sync_policy_version")) if (!releasePolicy(values.getValue(key))) rejectRelease(key)
    if (!values.getValue("registry_source_commit").matches(Regex("[0-9a-f]{40}")) || values.getValue("registry_source_commit").all { it == '0' }) rejectRelease("registry_source_commit")
    try {
        val bytes = Base64.getDecoder().decode(values.getValue("play_license_public_key"))
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes)) as RSAPublicKey
        if (key.modulus.bitLength() < 2048 || key.publicExponent.bitLength() < 2 || !key.publicExponent.testBit(0) || !key.encoded.contentEquals(bytes)) rejectRelease("play_license_public_key")
    } catch (_: Exception) { rejectRelease("play_license_public_key") }
    // Public inputs may not silently win over conflicting existing build properties.
    val legacy = mapOf("umar.normalAuth.approved" to "true", "umar.normalAuth.publicOrigin" to values.getValue("public_origin"),
        "umar.normalAuth.syncPolicyVersion" to values.getValue("sync_policy_version"),
        "umar.normalAuth.ownerDeclarationVersion" to values.getValue("owner_declaration_version"),
        "umar.normalAuth.registrySourceCommit" to values.getValue("registry_source_commit"),
        "ayailmu.playLicenseKey" to values.getValue("play_license_public_key"))
    for ((key, expected) in legacy) if (providers.gradleProperty(key).orNull?.let { it != expected } == true) rejectRelease("conflicting build property")
    for (key in listOf("umar.normalQa.buildEnabled", "umar.ownerRemote.buildEnabled"))
        if (providers.gradleProperty(key).orNull?.let { it != "false" } == true) rejectRelease("private build opt-in")
    values.toMap()
}
extra["ayailmuPublicReleaseValues"] = releaseValues

val checkInputs = tasks.register("checkPublicReleaseInputs") {
    group = "verification"
    description = "Validate explicit public release inputs offline; no launch approval, signing or service change."
    outputs.upToDateWhen { false }
    doLast {
        if (releaseValues.isEmpty()) throw GradleException("Public release inputs are required; set ayailmu.publicRelease.inputs to the reviewed input file")
        val keyFingerprint = MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(releaseValues.getValue("play_license_public_key")))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(releaseValues.toSortedMap().entries.joinToString("") { "${it.key}=${it.value}\n" }.toByteArray(StandardCharsets.US_ASCII))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val report = linkedMapOf<String, Any>("format_version" to 1, "launch_ready" to false, "input_values_sha256" to fingerprint,
            "verification" to "offline-configuration-only", "inputs" to (releaseValues - "play_license_public_key"),
            "play_public_key_sha256" to keyFingerprint,
            "selected_prod_features" to mapOf("auth" to true, "billing" to true, "demo" to false, "sync_lab" to false, "owner_sign_in_only" to false),
            "unverified_gates" to listOf("Store identity, signing, version history and account ownership",
                "Public DNS/TLS, issuer, mail and actual native/provider lifecycle",
                "Full curriculum and feature parity; current reviewed production assets are only one adult Mathematics unit",
                "Published policy/support/web deletion URLs and legal approval", "Real purchases, restore/refund and physical-device acceptance",
                "Erasure rollout, provider authority, retention and backup/restore operations", "Existing-install data and identity migration"))
        val output = layout.buildDirectory.file("reports/public-release/configuration-plan.json").get().asFile
        output.parentFile.mkdirs()
        output.writeText(JsonOutput.prettyPrint(JsonOutput.toJson(report)) + "\n")
        logger.lifecycle("Public release inputs validated offline. launch_ready=false; no identity ownership, endpoint, feature acceptance or deployment verified.")
    }
}
for ((alias, artifact) in listOf("assemblePublicReleaseCandidate" to "assembleProdRelease", "bundlePublicReleaseCandidate" to "bundleProdRelease")) {
    tasks.register(alias) {
        group = "build"
        description = "Build an unsigned public-configuration candidate only after explicit input validation. Not launch approval."
        dependsOn(checkInputs, artifact)
    }
}
if (inputPath != null) tasks.matching { it.name == "preProdReleaseBuild" }.configureEach { dependsOn(checkInputs) }
tasks.matching { it.name in setOf("preProdReleaseBuild", "generateProdReleaseBuildConfig", "assembleProdRelease", "bundleProdRelease") }.configureEach { mustRunAfter(checkInputs) }
