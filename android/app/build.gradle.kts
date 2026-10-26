import java.net.URI
import java.security.GeneralSecurityException
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
        buildConfigField("String", "NORMAL_AUTH_PUBLIC_ORIGIN", "\"\"")
        buildConfigField("String", "NORMAL_SYNC_POLICY_VERSION", "\"\"")
        buildConfigField("String", "NORMAL_OWNER_DECLARATION_VERSION", "\"\"")
        buildConfigField("String", "NORMAL_REGISTRY_SOURCE_COMMIT", "\"\"")
        // Play licence key (Play Console > Monetisation setup) for the local purchase signature check (CR-BIL-4).
        // Set `ayailmu.playLicenseKey=...` in ~/.gradle/gradle.properties on the build machine; never commit it.
        // Empty (the default) skips the check, which is fine for demo builds and before the Play app exists.
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
