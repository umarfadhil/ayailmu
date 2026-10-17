// :core:engine — deterministic learning engine (scoring, freshness, planner, skill projection).
// Pure Kotlin/JVM: no Android imports, time via injected Clock, randomness via injected Random (CR-ARC-3).
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors.set(true) }
}

// Bundled packs and rules are visible to tests as classpath resources.
sourceSets {
    test {
        resources.srcDir(rootProject.file("content/src/main/assets"))
    }
}

dependencies {
    api(project(":core:model"))
    api(project(":core:content"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
