package id.petalytix.ayailmu.core.engine

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * CR-KT-9 guard. Android compiles `Regex` with ICU, which rejects a bare `{` or `}` that the JVM accepts, so a
 * JVM unit test can never see the crash. This scans every `Regex("…")` literal in main sources of all modules and
 * fails on a brace that is neither escaped nor part of a `{n}`, `{n,}` or `{n,m}` quantifier.
 */
class RegexPortabilityTest {
    private val androidRoot: File = File("../..").canonicalFile
    private val literal = Regex("""Regex\("((?:[^"\\]|\\.)*)"\)""")
    private val quantifier = Regex("""\{\d+(,\d*)?\}""")

    @Test
    fun `no regex literal in main sources has an unescaped brace`() {
        assertTrue(File(androidRoot, "settings.gradle.kts").exists(), "expected the android/ root at $androidRoot")
        val sources =
            androidRoot
                .walkTopDown()
                .onEnter { it.name != "build" && !it.name.startsWith(".") }
                .filter { it.isFile && it.extension == "kt" && it.invariantSeparatorsPath.contains("/src/main/") }
                .toList()
        assertTrue(sources.isNotEmpty())
        val problems =
            sources.flatMap { file ->
                file.readLines().withIndex().flatMap { (i, line) ->
                    literal.findAll(line).mapNotNull { m ->
                        val pattern = m.groupValues[1].replace("\\\\", "\\")
                        badBrace(pattern)?.let { "${file.relativeTo(androidRoot)}:${i + 1} index $it in $pattern" }
                    }
                }
            }
        assertTrue(problems.isEmpty(), "Escape these braces (CR-KT-9):\n" + problems.joinToString("\n"))
    }

    @Test
    fun `the checker itself flags a bare closing brace and accepts quantifiers`() {
        assertTrue(badBrace("\\{(\\w+)}") != null)
        assertTrue(badBrace("\\{(\\w+)\\}") == null)
        assertTrue(badBrace("^-?\\d{1,3}(\\.\\d{3})+$") == null)
        assertTrue(badBrace("[{}]") == null)
        assertTrue(badBrace("a{b}") != null)
    }

    /** Index of the first brace ICU would reject, or null. Braces inside a character class are literal. */
    private fun badBrace(p: String): Int? {
        var i = 0
        var inClass = false
        while (i < p.length) {
            val c = p[i]
            when {
                c == '\\' -> i++
                inClass -> if (c == ']') inClass = false
                c == '[' -> inClass = true
                c == '{' -> {
                    val q = quantifier.matchAt(p, i) ?: return i
                    i = q.range.last
                }
                c == '}' -> return i
            }
            i++
        }
        return null
    }
}
