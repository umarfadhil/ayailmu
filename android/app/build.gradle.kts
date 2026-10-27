import java.time.Instant
import java.net.URI
import java.security.GeneralSecurityException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.nio.file.Files
import java.nio.file.Paths
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.Locale

// :app — DI wiring, navigation and feature screens (features split into modules when > ~40 files, CR-ARC-1).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.roborazzi)
}

// Public URLs are configuration, never credentials. Reject malformed input before generating Java.
val syncLabPublicOrigin = providers.gradleProperty("umar.syncLab.publicOrigin").orElse("").get()
if (syncLabPublicOrigin.isNotEmpty()) {
    val uri = runCatching { URI(syncLabPublicOrigin) }.getOrNull()
    require(
        uri != null && uri.scheme == "https" && !uri.host.isNullOrEmpty() &&
            uri.host == uri.host.lowercase(Locale.ROOT) && uri.rawUserInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.isNullOrEmpty() &&
            (uri.port == -1 || uri.port in 1..65535) &&
            uri.rawAuthority == uri.host + if (uri.port == -1) "" else ":${uri.port}",
    ) { "umar.syncLab.publicOrigin must be a canonical HTTPS origin without credentials, path, query or fragment" }
}

// A different remote origin must never receive another environment's tokens/outbox after an APK
// update. A distinct Android application ID isolates Room, settings, files and Keystore together.
val syncLabIdentitySuffix = if (syncLabPublicOrigin.isEmpty()) ".synclab" else {
    val digest = MessageDigest.getInstance("SHA-256").digest(syncLabPublicOrigin.toByteArray(Charsets.US_ASCII))
        .joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    ".synclab.remote.r$digest"
}

// Normal owner auth is dormant unless every release-readiness value is deliberately supplied.
val normalAuthApproved = providers.gradleProperty("umar.normalAuth.approved").orElse("false").get() == "true"
val normalAuthOrigin = providers.gradleProperty("umar.normalAuth.publicOrigin").orElse("").get()
val normalSyncPolicy = providers.gradleProperty("umar.normalAuth.syncPolicyVersion").orElse("").get()
val normalOwnerDeclaration = providers.gradleProperty("umar.normalAuth.ownerDeclarationVersion").orElse("").get()
val normalRegistrySource = providers.gradleProperty("umar.normalAuth.registrySourceCommit").orElse("").get()
if (normalAuthOrigin.isNotEmpty()) {
    val uri = runCatching { URI(normalAuthOrigin) }.getOrNull()
    require(uri != null && uri.scheme == "https" && !uri.host.isNullOrEmpty() &&
        uri.host == uri.host.lowercase(Locale.ROOT) && uri.rawUserInfo == null && uri.rawQuery == null &&
        uri.rawFragment == null && uri.rawPath.isNullOrEmpty() && (uri.port == -1 || uri.port in 1..65535) &&
        uri.rawAuthority == uri.host + if (uri.port == -1) "" else ":${uri.port}") {
        "umar.normalAuth.publicOrigin must be a canonical HTTPS origin"
    }
}
if (normalSyncPolicy.isNotEmpty()) require(normalSyncPolicy.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")))
if (normalOwnerDeclaration.isNotEmpty()) require(normalOwnerDeclaration.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")))
if (normalRegistrySource.isNotEmpty()) require(normalRegistrySource.matches(Regex("[0-9a-f]{40}")))
if (normalAuthApproved) require(normalAuthOrigin.isNotEmpty() && normalSyncPolicy.isNotEmpty() && normalOwnerDeclaration.isNotEmpty() && normalRegistrySource.isNotEmpty()) {
    "Approved normal auth requires origin, owner declaration, sync policy and registry source"
}

// Private normal QA inputs are separate from production approval and are required only by QA tasks.
val normalQaBuildEnabled = providers.gradleProperty("umar.normalQa.buildEnabled").orElse("false").get() == "true"
val normalQaApproved = providers.gradleProperty("umar.normalQa.approved").orElse("false").get() == "true"
val normalQaOrigin = providers.gradleProperty("umar.normalQa.publicOrigin").orElse("").get()
val normalQaSyncPolicy = providers.gradleProperty("umar.normalQa.syncPolicyVersion").orElse("").get()
val normalQaOwnerDeclaration = providers.gradleProperty("umar.normalQa.ownerDeclarationVersion").orElse("").get()
val normalQaRegistrySource = providers.gradleProperty("umar.normalQa.registrySourceCommit").orElse("").get()
val normalQaCaFile = providers.gradleProperty("umar.normalQa.publicCaFile").orElse("").get()
val normalQaCaSha256 = providers.gradleProperty("umar.normalQa.publicCaSha256").orElse("").get()
val NORMAL_QA_ORIGIN = "https://localhost:58443"
require(normalQaOrigin.isEmpty() || normalQaOrigin == NORMAL_QA_ORIGIN) { "umar.normalQa.publicOrigin must be exactly $NORMAL_QA_ORIGIN" }
if (normalQaSyncPolicy.isNotEmpty()) require(normalQaSyncPolicy.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")))
if (normalQaOwnerDeclaration.isNotEmpty()) require(normalQaOwnerDeclaration.matches(Regex("[a-z0-9][a-z0-9-]{2,79}")))
if (normalQaRegistrySource.isNotEmpty()) require(normalQaRegistrySource.matches(Regex("[0-9a-f]{40}")))
if (normalQaApproved) require(normalQaOrigin == NORMAL_QA_ORIGIN && normalQaSyncPolicy.isNotEmpty() && normalQaOwnerDeclaration.isNotEmpty() && normalQaRegistrySource.isNotEmpty()) {
    "Approved normal QA requires exact origin, owner declaration, sync policy and registry source"
}

// Temporary owner-only remote QA is a separate opt-in, never a localhost QA retarget.
val ownerRemoteBuildEnabled = providers.gradleProperty("umar.ownerRemote.buildEnabled").orElse("false").get() == "true"
val ownerRemoteApproved = providers.gradleProperty("umar.ownerRemote.approved").orElse("false").get() == "true"
val ownerRemoteOrigin = providers.gradleProperty("umar.ownerRemote.publicOrigin").orElse("").get()
val ownerRemoteSyncPolicy = providers.gradleProperty("umar.ownerRemote.syncPolicyVersion").orElse("").get()
val ownerRemoteDeclaration = providers.gradleProperty("umar.ownerRemote.ownerDeclarationVersion").orElse("").get()
val ownerRemoteRegistry = providers.gradleProperty("umar.ownerRemote.registrySourceCommit").orElse("").get()
val ownerRemoteExpiry = providers.gradleProperty("umar.ownerRemote.expiresAtUtc").orElse("").get()
if (ownerRemoteBuildEnabled) {
    val uri = runCatching { URI(ownerRemoteOrigin) }.getOrNull()
    val expiry = runCatching { Instant.parse(ownerRemoteExpiry) }.getOrNull()
    val now = Instant.now()
    require(ownerRemoteApproved && uri != null && uri.scheme == "https" &&
        uri.host != null && uri.host.matches(Regex("[a-z0-9]+(?:-[a-z0-9]+)*\\.trycloudflare\\.com")) &&
        uri.rawAuthority == uri.host && uri.rawPath.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null &&
        ownerRemoteSyncPolicy == "qa-owner-sync-v1" && ownerRemoteDeclaration == "qa-adult-owner-v1" &&
        ownerRemoteRegistry == "815e30f0da284b9818fadc0143f4da92544384d3" &&
        expiry != null && expiry.isAfter(now) && expiry.isBefore(now.plusSeconds(36 * 3600))) {
        "ownerRemote requires the approved temporary HTTPS origin, exact private-owner policy/registry and unexpired <=36h handoff"
    }
}
val ownerRemoteIdentity = MessageDigest.getInstance("SHA-256").digest(ownerRemoteOrigin.toByteArray(Charsets.US_ASCII))
    .joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }

val playLicenseKey = providers.gradleProperty("ayailmu.playLicenseKey").getOrElse("")

fun validatePlayLicenseKey(required: Boolean): String {
    val key = playLicenseKey.trim()
    if (key.isEmpty()) {
        require(!required) {
            "checkPlayLicenseKey requires a nonempty Base64-encoded RSA X.509 public key in ayailmu.playLicenseKey"
        }
        return key
    }
    try {
        val encoded = Base64.getDecoder().decode(key)
        KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(encoded))
    } catch (_: IllegalArgumentException) {
        throw IllegalArgumentException("ayailmu.playLicenseKey must be a Base64-encoded RSA X.509 public key")
    } catch (_: GeneralSecurityException) {
        throw IllegalArgumentException("ayailmu.playLicenseKey must be a Base64-encoded RSA X.509 public key")
    }
    return key
}

tasks.register("checkPlayLicenseKey") {
    group = "verification"
    description = "Requires a syntactically usable Play licensing RSA public key; does not verify account ownership."
    doLast { validatePlayLicenseKey(required = true) }
}

android {
    namespace = "id.petalytix.ayailmu"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "id.petalytix.ayailmu"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        // Build identity is mirrored in ai-memory/FILE_MAP.md (CR-REL-4).
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
        // Optional static config override (CR-CFG-2). Empty = disabled. Never required.
        buildConfigField("String", "REMOTE_CONFIG_URL", "\"\"")
        buildConfigField("boolean", "SYNC_LAB_ENABLED", "false")
        buildConfigField("boolean", "BILLING_ENABLED", "${playLicenseKey.isNotEmpty()}")
        buildConfigField("boolean", "NORMAL_AUTH_APPROVED", "false")
        buildConfigField("boolean", "NORMAL_OWNER_SIGN_IN_ONLY", "false")
        buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"\"")
        buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"\"")
        buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"\"")
        buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"\"")
        // Play licence key (Play Console > Monetisation setup) for the local purchase signature check (CR-BIL-4).
        // Set `ayailmu.playLicenseKey=...` in ~/.gradle/gradle.properties on the build machine; never commit it.
        // Empty (the default) skips the check, which is fine for demo builds and before the Play app exists.
        buildConfigField("String", "NORMAL_AUTH_REQUIRED_ORIGIN", "\"\"")
        buildConfigField("String", "PLAY_LICENSE_KEY", "\"${validatePlayLicenseKey(required = false)}\"")
    }

    // Two flavors (CR-ENG-2): demo shows unapproved content behind a draft banner; prod shows only approved items.
    flavorDimensions += "mode"
    productFlavors {
        create("demo") {
            dimension = "mode"
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-demo"
            buildConfigField("boolean", "DEVELOPER_DEMO", "true")
            buildConfigField("boolean", "NORMAL_AUTH_APPROVED", "$normalAuthApproved")
            buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"$normalAuthOrigin\"")
            buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"$normalSyncPolicy\"")
            buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"$normalOwnerDeclaration\"")
            buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"$normalRegistrySource\"")
        }
        create("syncLab") {
            dimension = "mode"
            applicationIdSuffix = syncLabIdentitySuffix
            versionNameSuffix = "-synclab"
            buildConfigField("boolean", "DEVELOPER_DEMO", "true")
            buildConfigField("boolean", "SYNC_LAB_ENABLED", "true")
            buildConfigField("String", "SYNC_LAB_PUBLIC_ORIGIN", "\"$syncLabPublicOrigin\"")
            manifestPlaceholders["appAuthRedirectScheme"] = "id.petalytix.ayailmu$applicationIdSuffix"
        }
        create("prod") {
            dimension = "mode"
            buildConfigField("boolean", "DEVELOPER_DEMO", "false")
            buildConfigField("boolean", "NORMAL_AUTH_APPROVED", "$normalAuthApproved")
            buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"$normalAuthOrigin\"")
            buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"$normalSyncPolicy\"")
            buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"$normalOwnerDeclaration\"")
            buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"$normalRegistrySource\"")
        }
        create("ownerRemote") {
            dimension = "mode"
            applicationIdSuffix = ".ownerbeta.r$ownerRemoteIdentity"
            versionNameSuffix = "-owner-beta"
            buildConfigField("boolean", "DEVELOPER_DEMO", "false")
            buildConfigField("boolean", "SYNC_LAB_ENABLED", "false")
            buildConfigField("boolean", "BILLING_ENABLED", "false")
            buildConfigField("boolean", "NORMAL_AUTH_APPROVED", "$ownerRemoteApproved")
            buildConfigField("boolean", "NORMAL_OWNER_SIGN_IN_ONLY", "true")
            buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"$ownerRemoteOrigin\"")
            buildConfigField("String", "NORMAL_AUTH_REQUIRED_ORIGIN", "\"$ownerRemoteOrigin\"")
            buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"$ownerRemoteSyncPolicy\"")
            buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"$ownerRemoteDeclaration\"")
            buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"$ownerRemoteRegistry\"")
        }
        create("normalQa") {
            dimension = "mode"
            applicationIdSuffix = ".normalqa"
            versionNameSuffix = "-normalqa"
            buildConfigField("boolean", "DEVELOPER_DEMO", "false")
            buildConfigField("boolean", "SYNC_LAB_ENABLED", "false")
            buildConfigField("boolean", "BILLING_ENABLED", "false")
            buildConfigField("boolean", "NORMAL_AUTH_APPROVED", "$normalQaApproved")
            buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"$normalQaOrigin\"")
            buildConfigField("String", "NORMAL_AUTH_REQUIRED_ORIGIN", "\"$NORMAL_QA_ORIGIN\"")
            buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"$normalQaSyncPolicy\"")
            buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"$normalQaOwnerDeclaration\"")
            buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"$normalQaRegistrySource\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signing config is added on the Windows machine (CR-REL-5); never commit keystore secrets.
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // A learner-facing string missing in either language is a build error, not a warning (CR-I18N-5).
        error += listOf("MissingTranslation", "ExtraTranslation", "HardcodedText")
        abortOnError = true
        checkDependencies = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        unitTests {
            // Robolectric screenshot tests need real resources (strings in both languages, themes).
            isIncludeAndroidResources = true
        }
    }

    // App unit tests run the real session loop on the bundled packs (SessionViewModelTest, StepMapperTest).
    sourceSets {
        getByName("demo").java.srcDir("src/nonLab/java")
        getByName("demo").manifest.srcFile("src/nonLab/AndroidManifest.xml")
        getByName("prod").java.srcDir("src/nonLab/java")
        getByName("prod").manifest.srcFile("src/nonLab/AndroidManifest.xml")
        getByName("ownerRemote").apply {
            java.srcDir("src/nonLab/java")
            manifest.srcFile("src/ownerRemote/AndroidManifest.xml")
        }
        getByName("normalQa").apply {
            java.srcDir("src/nonLab/java")
            manifest.srcFile("src/normalQa/AndroidManifest.xml")
            res.srcDir(layout.buildDirectory.dir("generated/res/normalQaTrust"))
            assets.srcDir("src/normalQa/assets")
        }
        getByName("test") {
            resources.srcDir(rootProject.file("content/src/main/assets"))
        }
    }
}

// Screenshot baselines are committed next to the tests (P3b): record with
// `./gradlew :app:recordRoborazziDemoDebug`, check with `:app:verifyRoborazziDemoDebug`.
roborazzi {
    outputDir.set(file("src/test/screenshots"))
}

// The Compose test activity (ui-test-manifest) is debug-only, so screenshot tests run in debug variants only.
tasks.withType<Test>().configureEach {
    if (name.contains("Release")) exclude("**/Screenshot*")
    if (name.contains("SyncLab")) {
        systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
        testLogging { events("passed", "failed", "skipped"); showStandardStreams = true }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core:sync"))
    "syncLabImplementation"(libs.appauth)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    implementation("com.google.crypto.tink:tink-android:1.24.0")
    implementation(project(":core:model"))
    implementation(project(":core:engine"))
    implementation(project(":core:content"))
    implementation(project(":core:data"))
    implementation(project(":core:billing"))
    implementation(project(":core:design"))
    implementation(project(":content"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat) // per-app language on API 26–32 (CR-I18N-2)
    implementation(libs.androidx.activity.compose)
    implementation(libs.bundles.lifecycle)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.serialization.json)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.bundles.compose)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    testImplementation(libs.junit)
    "testSyncLabImplementation"(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(composeBom)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(composeBom)
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}


// QA-only trust preparation. Production/demo/syncLab never evaluate or bundle this input.
tasks.register("prepareNormalQaTrust") {
    group = "build"
    description = "Validate the designated public CA and copy only its public certificate into normalQa resources"
    val output = layout.buildDirectory.file("generated/res/normalQaTrust/raw/qa_public_ca")
    inputs.property("caFile", normalQaCaFile)
    inputs.property("caSha256", normalQaCaSha256)
    outputs.file(output)
    outputs.upToDateWhen { false }
    if (normalQaCaFile.isNotEmpty()) inputs.file(normalQaCaFile).withPropertyName("publicCaFile")
    doLast {
        require(normalQaCaFile.isNotEmpty()) { "normalQa requires umar.normalQa.publicCaFile from the verified handoff" }
        require(normalQaCaSha256.matches(Regex("[0-9a-f]{64}"))) { "umar.normalQa.publicCaSha256 must be a lowercase SHA-256 fingerprint" }
        val path = Paths.get(normalQaCaFile)
        require(Files.isRegularFile(path)) { "normalQa public CA file is absent" }
        val bytes = Files.readAllBytes(path)
        require(bytes.size in 1..65_536) { "normalQa public CA is empty or too large" }
        require(!bytes.toString(Charsets.ISO_8859_1).contains("PRIVATE KEY")) { "normalQa input must contain only a public certificate, never key material" }
        val certificates = Files.newInputStream(path).use { CertificateFactory.getInstance("X.509").generateCertificates(it) }
        require(certificates.size == 1) { "normalQa requires exactly one designated public CA certificate" }
        val certificate = certificates.single() as X509Certificate
        certificate.checkValidity()
        require(certificate.basicConstraints >= 0) { "normalQa certificate is not a CA" }
        require(certificate.keyUsage == null || certificate.keyUsage[5]) { "normalQa CA cannot sign certificates" }
        val actual = MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
        require(actual == normalQaCaSha256) { "normalQa public CA fingerprint mismatch" }
        val destination = output.get().asFile
        destination.parentFile.mkdirs()
        destination.writeBytes(certificate.encoded)
    }
}
tasks.configureEach { if (normalQaBuildEnabled && name == "preNormalQaDebugBuild") dependsOn("prepareNormalQaTrust") }
// Variant-level isolation: no QA release variant exists. QA debug is a separate build opt-in,
// not an auth approval and never a default prod/demo/CI dependency.
androidComponents {
    beforeVariants(selector().withName("ownerRemoteRelease")) { variant -> variant.enable = false }
    beforeVariants(selector().withName("ownerRemoteDebug")) { variant -> variant.enable = ownerRemoteBuildEnabled }
    beforeVariants(selector().withName("normalQaRelease")) { variant -> variant.enable = false }
    beforeVariants(selector().withName("normalQaDebug")) { variant -> variant.enable = normalQaBuildEnabled }
}
