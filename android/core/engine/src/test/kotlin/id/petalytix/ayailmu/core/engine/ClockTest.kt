package id.petalytix.ayailmu.core.engine

import java.time.Instant
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class ClockTest {
    @Test
    fun `today follows the Jakarta zone, not UTC`() {
        // 2026-10-16 23:30 UTC is already 2026-10-17 06:30 in Jakarta.
        val clock = FixedClock(Instant.parse("2026-10-16T23:30:00Z"))
        assertEquals(LocalDate.of(2026, 10, 17), clock.today())
    }

    @Test
    fun `advanceDays moves exactly one calendar day`() {
        val clock = FixedClock(Instant.parse("2026-10-16T05:00:00Z"))
        val before = clock.today()
        clock.advanceDays(1)
        assertEquals(before.plusDays(1), clock.today())
    }

    @Test
    fun `seeded rng is reproducible per learner and session`() {
        val a = SeededRngFactory.forSession("learner-1", 3).nextInt()
        val b = SeededRngFactory.forSession("learner-1", 3).nextInt()
        val c = SeededRngFactory.forSession("learner-1", 4).nextInt()
        assertEquals(a, b)
        assertNotEquals(a, c)
    }
}
