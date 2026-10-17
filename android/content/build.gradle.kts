// :content — bundled packs, rule configs and audio as Android assets (CR-ENG-1, CR-CFG-1). No code.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "id.petalytix.ayailmu.content"
    compileSdk = libs.versions.compileSdk.get().toInt()
    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
    }
    // Keep JSON packs uncompressed-readable; nothing here is obfuscated.
    androidResources {
        noCompress += listOf("json", "ogg")
    }
}
