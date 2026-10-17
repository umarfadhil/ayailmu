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
    var failures = 0
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
        val problems = PackValidator.validate(pack)
        if (problems.isEmpty()) {
            println("ok   $rel (${pack.items.size} items, ${pack.meta.instructionLangs.joinToString("+") { it.tag }})")
        } else {
            println("FAIL $rel")
            problems.forEach { println("     - $it") }
            failures++
        }
    }
    if (failures > 0) {
        System.err.println("validatePacks: $failures pack(s) failed")
        exitProcess(1)
    }
}
