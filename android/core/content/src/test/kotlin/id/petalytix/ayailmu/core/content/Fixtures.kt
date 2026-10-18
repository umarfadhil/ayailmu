package id.petalytix.ayailmu.core.content

/** Loads the bundled packs from the test classpath (wired in build.gradle.kts from content/src/main/assets). */
object Fixtures {
    fun arabic(): ContentPack = load("packs/bahasa/arab/v1.json")

    /** Frozen copy of the P1 math sample (src/test/resources/fixtures); the bundled kids pack keeps growing. */
    fun math(): ContentPack = load("fixtures/mat-sample-v1.json")

    fun load(resource: String): ContentPack {
        val stream = Fixtures::class.java.classLoader.getResourceAsStream(resource)
        requireNotNull(stream) { "missing test resource $resource (is content/src/main/assets on the test classpath?)" }
        return stream.use { PackLoader.parse(it.readBytes().toString(Charsets.UTF_8)) }
    }
}
