// :core:content — pack schema, validator and loader (pure Kotlin so the validator can run in CI without Android).
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors.set(true) }
}

// Bundled packs are visible to tests as classpath resources (e.g. "packs/bahasa/arab/v1.json").
sourceSets {
    test {
        resources.srcDir(rootProject.file("content/src/main/assets"))
    }
}

dependencies {
    api(project(":core:model"))
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test.junit)
}

// `./gradlew :core:content:validatePacks` — fails the build on any pack problem (CR-I18N-5). Part of `check`.
val validatePacks by tasks.registering(JavaExec::class) {
    group = "verification"
    description = "Validates every content pack under content/src/main/assets/packs"
    mainClass.set("id.petalytix.ayailmu.core.content.PackValidatorCliKt")
    classpath = sourceSets["main"].runtimeClasspath
    args(rootProject.file("content/src/main/assets").absolutePath)
}

tasks.named("check") { dependsOn(validatePacks) }
