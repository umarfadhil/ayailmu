package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Who an item or pack is written for (docs/syllabus/00_FRAMEWORK.md §1). */
@Serializable
enum class Audience(val code: String) {
    @SerialName("kids")
    KIDS("K"),

    @SerialName("adults")
    ADULTS("A"),
}

/** The four levels shared by every subject; meaning differs per audience (framework §1). */
@Serializable
enum class Level(val code: String) {
    @SerialName("pemula")
    PEMULA("P"),

    @SerialName("menengah")
    MENENGAH("M"),

    @SerialName("mahir")
    MAHIR("H"),

    @SerialName("master")
    MASTER("X"),
}

/** The four subjects on the shelf. */
@Serializable
enum class Subject(val code: String) {
    @SerialName("bahasa")
    BAHASA("BHS"),

    @SerialName("matematika")
    MATEMATIKA("MAT"),

    @SerialName("sains")
    SAINS("SNS"),

    @SerialName("sosial_seni")
    SOSIAL_SENI("SOS"),
}

/** Learning-rule mode of a track (framework §3, CR-ENG-4). */
@Serializable
enum class TrackMode {
    @SerialName("evidence")
    EVIDENCE,

    @SerialName("casual")
    CASUAL,
}

/**
 * Item pools from the Arabic course plan, reused by every track (CR-ENG-3). FOCUS = focused question after a
 * serious mistake: never evidence, may repeat. GEM = hidden-gem cards (framework §1b): never evidence.
 */
@Serializable
enum class Pool {
    INSTR,
    PRACT,
    READY,
    D7,
    D30,
    REMED,
    TRANS,
    SPARE,
    MT,
    ENTRY,
    REPROBE,
    FOCUS,
    GEM,
    ;

    /** Pools whose attempts count as "practice on the unit" for D7/D30 due dates. */
    val isPractice: Boolean get() = this in PRACTICE

    /** Pools counted toward "enough practice before READY". */
    val isCountedPractice: Boolean get() = this in COUNTED

    companion object {
        val PRACTICE = setOf(INSTR, PRACT, READY, REMED, TRANS, SPARE, MT)
        val COUNTED = setOf(PRACT, REMED, TRANS, SPARE, MT)
    }
}
