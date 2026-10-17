package id.petalytix.ayailmu.core.engine

import kotlin.random.Random

/**
 * Randomness in the engine is injected and seedable (CR-ARC-3): item order, option shuffles and the
 * position of a gem inside a step must be reproducible from (seed, profile, session).
 */
fun interface RngFactory {
    fun forSession(
        learnerId: String,
        sessionIndex: Int,
    ): Random
}

/** Stable seed derived from learner and session so replays shuffle identically. */
object SeededRngFactory : RngFactory {
    override fun forSession(
        learnerId: String,
        sessionIndex: Int,
    ): Random {
        var h = 1125899906842597L
        for (ch in learnerId) h = 31 * h + ch.code
        h = 31 * h + sessionIndex
        return Random(h)
    }
}
