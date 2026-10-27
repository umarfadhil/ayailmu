plugins {
    kotlin("multiplatform") version "2.2.20"
    kotlin("plugin.serialization") version "2.2.20"
}
repositories { mavenCentral() }
val prepareSharedSources by tasks.registering(Exec::class) {
    commandLine("python3", "scripts/prepare-shared-sources.py")
    inputs.dir("../../android/core/model/src/main/kotlin")
    inputs.dir("../../android/core/content/src/main/kotlin")
    inputs.dir("../../android/core/engine/src/main/kotlin")
    inputs.file("scripts/prepare-shared-sources.py")
    inputs.dir("src")
    outputs.dir(layout.buildDirectory.dir("generated/shared"))
}
kotlin {
    iosArm64 { binaries.framework { baseName = "AyaIlmuSharedLearning"; isStatic = true } }
    iosSimulatorArm64 { binaries.framework { baseName = "AyaIlmuSharedLearning"; isStatic = true } }
    jvm()
    sourceSets {
        val commonMain by getting { dependencies { implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0") } }
        val iosArm64Main by getting { kotlin.srcDirs("src/sharedMain/kotlin", layout.buildDirectory.dir("generated/shared")) }
        val iosSimulatorArm64Main by getting { kotlin.srcDirs("src/sharedMain/kotlin", layout.buildDirectory.dir("generated/shared")) }
        val jvmMain by getting { kotlin.srcDirs("src/sharedMain/kotlin", layout.buildDirectory.dir("generated/shared")) }
        val jvmTest by getting { dependencies { implementation(kotlin("test")) } }
    }
}
tasks.matching { it.name.startsWith("compileKotlin") }.configureEach { dependsOn(prepareSharedSources) }
