// Root build file. Plugins are declared here with `apply false` and applied per module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.roborazzi) apply false
}

// Build outputs live OUTSIDE OneDrive on Windows (CR-REL-7). OneDrive sync, antivirus and the long-lived
// Gradle/Kotlin daemons hold files under build/ open, which breaks `clean` ("Unable to delete directory …
// engine.jar") and incremental compiles. When the repo sits under a OneDrive path, every module builds into
// %LOCALAPPDATA%\ayailmu-build\<module>. Override with -Payailmu.buildRoot=<dir>; CI/Linux keeps build/.
// Off-switch: put `ayailmu.externalBuild=false` in gradle.properties to build inside the repo again.
// After changing any of this, run "Sync Project with Gradle Files" — Android Studio's Run button uses the
// synced model to find the APK and will otherwise look in the old folder ("Error loading build artifacts").
val externalBuildEnabled = providers.gradleProperty("ayailmu.externalBuild").orNull?.toBoolean() ?: true
val externalBuildRoot: File? =
    if (!externalBuildEnabled) {
        null
    } else {
        providers.gradleProperty("ayailmu.buildRoot").orNull?.let { file(it) }
            ?: System.getenv("LOCALAPPDATA")
                ?.takeIf { rootDir.absolutePath.contains("OneDrive", ignoreCase = true) }
                ?.let { File(it, "ayailmu-build") }
    }

if (externalBuildRoot != null) {
    allprojects {
        val moduleDir = if (path == ":") "root" else path.removePrefix(":").replace(':', File.separatorChar)
        layout.buildDirectory.set(File(externalBuildRoot, moduleDir))
    }
}

// ktlint on every module (CR-KT-1). Reported-only through P2 (code is written without an IDE/formatter in the
// cloud); flipped to ignoreFailures=false at the P3 gate. Style settings live in .editorconfig.
subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    extensions.configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        android.set(false)
        ignoreFailures.set(true)
        filter {
            exclude("**/generated/**")
            exclude("**/build/**")
        }
    }
}
