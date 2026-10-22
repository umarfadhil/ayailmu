plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<SourceSetContainer> {
            named("test") { resources.srcDir(rootProject.file("../android/content/src/main/assets")) }
        }
    }
}

allprojects {
    layout.buildDirectory.set(rootProject.layout.projectDirectory.dir("build/modules/" + path.replace(':', '_')))
}
