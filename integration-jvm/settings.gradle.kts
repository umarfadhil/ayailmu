pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { mavenCentral() }
    versionCatalogs { create("libs") { from(files("../android/gradle/libs.versions.toml")) } }
}
rootProject.name = "UmarNativeIntegrationJvm"
for (module in listOf("model", "content", "engine", "sync")) {
    include(":core:$module")
    project(":core:$module").projectDir = file("../android/core/$module")
}
