package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.consent.Consent
import id.petalytix.ayailmu.feature.progress.Count
import id.petalytix.ayailmu.feature.progress.ProgressCalculator
import id.petalytix.ayailmu.feature.reminder.ReminderTime
import id.petalytix.ayailmu.feature.session.SessionContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Pure P3b rules: progress counts, session length snapping, consent requirement, reminder timing. */
class P3bLogicTest {
    @Test
    fun `progress before any practice is empty and honest`() {
        val s = ProgressCalculator.compute(emptyList(), TestPacks.math.rules, TestPacks.math.content)
        assertFalse(s.hasAnyActivity)
        // Six skills are taught by the math sample (the gem card teaches none).
        assertEquals(Count(0, 6), s.learned)
        assertEquals(0, s.gems)
    }

    @Test
    fun `one session of don't-knows practises every skill but learns none, and finds the gem`() {
        val events = TestPacks.playDontKnow(TestPacks.math, TestPacks.profile())
        val s = ProgressCalculator.compute(events, TestPacks.math.rules, TestPacks.math.content)
        assertTrue(s.hasAnyActivity)
        assertEquals(TrackMode.CASUAL, s.mode)
        assertEquals(Count(0, 6), s.learned)
        assertEquals(6, s.practicing)
        assertEquals(1, s.gems)
        assertEquals(1, s.daysPracticed)
        assertEquals(Count(0, 0), s.remembered)
        assertEquals(0, s.waitingForCheck)
    }

    @Test
    fun `the arabic sample counts its words and starts with nothing remembered`() {
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        val events = TestPacks.playDontKnow(TestPacks.arabic, adult)
        val s = ProgressCalculator.compute(events, TestPacks.arabic.rules, TestPacks.arabic.content)
        assertEquals(TrackMode.EVIDENCE, s.mode)
        assertTrue(s.words.of > 0)
        assertEquals(0, s.words.done)
        assertEquals(0, s.learned.done)
        assertEquals(Count(0, 0), s.remembered)
    }

    @Test
    fun `session length snaps to what the track offers`() {
        val rules = TestPacks.math.rules // options 5 / 10 / 15, default 10
        assertEquals(10, SessionContent.budgetMinutes(null, rules))
        assertEquals(15, SessionContent.budgetMinutes(20, rules))
        assertEquals(5, SessionContent.budgetMinutes(7, rules))
        assertEquals(10, SessionContent.budgetMinutes(10, rules))
    }

    @Test
    fun `only evidence tracks need consent, and only until the current text is accepted`() {
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        assertTrue(Consent.required(TrackMode.EVIDENCE, adult))
        assertFalse(Consent.required(TrackMode.CASUAL, adult))
        assertFalse(Consent.required(TrackMode.EVIDENCE, adult.copy(consentVersion = Consent.VERSION)))
        assertTrue(Consent.required(TrackMode.EVIDENCE, adult.copy(consentVersion = "older-text")))
    }

    @Test
    fun `the trial is for 18 and over, using the younger possible age`() {
        assertTrue(Consent.oldEnough(2007, 2026)) // 18 or 19
        assertFalse(Consent.oldEnough(2008, 2026)) // could still be 17
        assertTrue(Consent.oldEnough(null, 2026)) // unknown: the checkbox decides
    }

    @Test
    fun `the reminder fires later today, or tomorrow once the time has passed`() {
        val zone = ZoneId.of("Asia/Jakarta")
        val morning = ZonedDateTime.of(2026, 10, 17, 9, 0, 0, 0, zone)
        assertEquals(ZonedDateTime.of(2026, 10, 17, 19, 30, 0, 0, zone), ReminderTime.next(morning, 19, 30))
        val evening = ZonedDateTime.of(2026, 10, 17, 20, 0, 0, 0, zone)
        assertEquals(ZonedDateTime.of(2026, 10, 18, 19, 30, 0, 0, zone), ReminderTime.next(evening, 19, 30))
        // Exactly at the time counts as passed: never fire twice in the same minute.
        assertEquals(ZonedDateTime.of(2026, 10, 18, 19, 30, 0, 0, zone), ReminderTime.next(ZonedDateTime.of(2026, 10, 17, 19, 30, 0, 0, zone), 19, 30))
    }

    @Test
    fun `the reminder keeps its wall-clock time across a daylight-saving change`() {
        val berlin = ZoneId.of("Europe/Berlin") // clocks go back on 2026-10-25
        val before = ZonedDateTime.of(2026, 10, 24, 20, 0, 0, 0, berlin)
        val next = ReminderTime.next(before, 19, 0)
        assertEquals(19, next.hour)
        assertEquals(25, next.dayOfMonth)
    }
}
