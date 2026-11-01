plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}
kotlin { jvmToolchain(17) }
dependencies {
    api(project(":core:model"))
    api(project(":core:engine"))
    api(project(":core:content"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
tasks.withType<Test>().configureEach {
    outputs.upToDateWhen { false }
    testLogging { events("passed", "failed", "skipped"); showStandardStreams = true }
}
