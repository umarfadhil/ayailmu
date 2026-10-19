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
        // Play licence key (Play Console > Monetisation setup) for the local purchase signature check (CR-BIL-4).
        // Set `ayailmu.playLicenseKey=...` in ~/.gradle/gradle.properties on the build machine; never commit it.
        // Empty (the default) skips the check, which is fine for demo builds and before the Play app exists.
        val playLicenseKey = providers.gradleProperty("ayailmu.playLicenseKey").getOrElse("")
        buildConfigField("String", "PLAY_LICENSE_KEY", "\"$playLicenseKey\"")
    }

    // Two flavors (CR-ENG-2): demo shows unapproved content behind a draft banner; prod shows only approved items.
    flavorDimensions += "mode"
    productFlavors {
        create("demo") {
            dimension = "mode"
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-demo"
            buildConfigField("boolean", "DEVELOPER_DEMO", "true")
        }
        create("syncLab") {
            dimension = "mode"
            applicationIdSuffix = ".synclab"
            versionNameSuffix = "-synclab"
            buildConfigField("boolean", "DEVELOPER_DEMO", "true")
            buildConfigField("boolean", "SYNC_LAB_ENABLED", "true")
            manifestPlaceholders["appAuthRedirectScheme"] = "id.petalytix.ayailmu.synclab"
        }
        create("prod") {
            dimension = "mode"
            buildConfigField("boolean", "DEVELOPER_DEMO", "false")
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
        getByName("prod").java.srcDir("src/nonLab/java")
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
    "syncLabImplementation"(project(":core:sync"))
    "syncLabImplementation"(libs.appauth)
    "syncLabImplementation"(libs.room.runtime)
    "syncLabImplementation"(libs.room.ktx)
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
