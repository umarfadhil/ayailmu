package id.petalytix.ayailmu.core.content

import java.io.File
import kotlin.system.exitProcess

// `./gradlew :core:content:validatePacks` — walks every .json file under content/src/main/assets/packs,
// parses and validates each pack, prints problems and exits 1 on any (CR-I18N-5, CR-ENG-1).
// Rule configs are validated by :core:engine tests (RuleConfig.parse), not here.
// Note: line comments on purpose — Kotlin block comments nest, so a glob like "packs/<star><star>" inside a
// KDoc opens a second comment and breaks the build (SESSION_LEARNINGS 2026-10-17).
fun main(args: Array<String>) {
    val root = File(args.firstOrNull() ?: "content/src/main/assets")
    if (!root.isDirectory) {
        System.err.println("validatePacks: assets folder not found: ${root.absolutePath}")
        exitProcess(2)
    }
    val packFiles =
        File(root, "packs").walkTopDown().filter { it.isFile && it.extension == "json" }.sortedBy { it.path }.toList()
    if (packFiles.isEmpty()) {
        println("validatePacks: no packs under ${File(root, "packs").path}; nothing to check")
        return
    }
    // Art keys and published tap regions (written by art/tools); packs may only reference what exists.
    val artFile = File(root, "art/index.json")
    val art = if (artFile.isFile) ContentJson.json.decodeFromString(ArtIndex.serializer(), artFile.readText()) else null
    if (art == null) println("validatePacks: no art/index.json - art keys not checked")
    var failures = 0
    // Stroke data for trace items (INTERACTIONS_AUDIO.md section 4); trace keys must exist in it.
    val strokesFile = File(root, "strokes/index.json")
    val strokes =
        if (!strokesFile.isFile) {
            println("validatePacks: no strokes/index.json - trace keys not checked")
            null
        } else {
            try {
                StrokeIndex.parse(strokesFile.readText()).also { index ->
                    val problems = index.problems()
                    if (problems.isEmpty()) {
                        println("ok   strokes/index.json (${index.keys.size} glyphs)")
                    } else {
                        println("FAIL strokes/index.json")
                        problems.forEach { println("     - $it") }
                        failures++
                    }
                }
            } catch (e: Exception) {
                println("FAIL strokes/index.json: cannot parse: ${e.message}")
                failures++
                null
            }
        }
    for (file in packFiles) {
        val rel = file.relativeTo(root).path
        val pack =
            try {
                PackLoader.parse(file.readText())
            } catch (e: Exception) {
                println("FAIL $rel: cannot parse: ${e.message}")
                failures++
                continue
            }
        val problems = PackValidator.validate(pack, art, strokes)
        if (problems.isEmpty()) {
            val stories = if (pack.stories.isEmpty()) "" else ", ${pack.stories.size} stories"
            println("ok   $rel (${pack.items.size} items$stories, ${pack.meta.instructionLangs.joinToString("+") { it.tag }})")
        } else {
            println("FAIL $rel")
            problems.forEach { println("     - $it") }
            failures++
        }
    }
    if (failures > 0) {
        System.err.println("validatePacks: $failures file(s) failed")
        exitProcess(1)
    }
}
