pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

// Lets Gradle download the JDK 17 that the pure-Kotlin modules request via jvmToolchain(17)
// when the machine has none installed (Android Studio only bundles JDK 21). See CR-REL-8.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "AyaIlmu"

include(":app")
include(":core:model")
include(":core:engine")
include(":core:content")
include(":core:data")
include(":core:billing")
include(":core:design")
include(":content")
