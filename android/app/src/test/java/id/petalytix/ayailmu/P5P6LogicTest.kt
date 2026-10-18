package id.petalytix.ayailmu

import android.app.Activity
import id.petalytix.ayailmu.core.billing.BillingNotice
import id.petalytix.ayailmu.core.billing.Entitlements
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.collection.Collections
import id.petalytix.ayailmu.feature.progress.ProgressCalculator
import id.petalytix.ayailmu.feature.puzzle.DailyPuzzle
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.speedround.SpeedRound
import id.petalytix.ayailmu.feature.store.AccessContext
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.AdultGate
import id.petalytix.ayailmu.feature.store.StoreData
import id.petalytix.ayailmu.feature.store.StoreDataSource
import id.petalytix.ayailmu.feature.store.StoreEvent
import id.petalytix.ayailmu.feature.store.StoreItem
import id.petalytix.ayailmu.feature.store.StoreViewModel
import id.petalytix.ayailmu.feature.units.UnitPicks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import kotlin.random.Random

/** Free tier and packs (P5), daily puzzle, speed round, gems and stickers (P6): the pure rules. */
@OptIn(ExperimentalCoroutinesApi::class)
class P5P6LogicTest {
    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private val kid = TestPacks.profile(id = "lrn-kid", kind = ProfileKind.ANAK)
    private val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)

    // ---- access (MONETIZATION_SCHEME free tier) ----

    @Test
    fun `free units are open, the rest needs the subject pack or all-access`() {
        val free = AccessPolicy.forTrack(Subject.MATEMATIKA, listOf("01"), AccessContext())
        assertTrue(free.allows("01"))
        assertFalse(free.allows("02"))
        assertEquals(Product.PACK_MATEMATIKA, free.product)
        assertTrue(free.locked)

        val pack = AccessPolicy.forTrack(Subject.MATEMATIKA, listOf("01"), AccessContext(Entitlements(owned = setOf(Product.PACK_MATEMATIKA))))
        assertTrue(pack.allows("07") && !pack.locked)

        val otherPack = AccessPolicy.forTrack(Subject.SAINS, listOf("01"), AccessContext(Entitlements(owned = setOf(Product.PACK_MATEMATIKA))))
        assertFalse(otherPack.allows("02"))

        val all = AccessPolicy.forTrack(Subject.SAINS, listOf("01"), AccessContext(Entitlements(owned = setOf(Product.ALL_ACCESS))))
        assertTrue(all.allows("02"))
    }

    @Test
    fun `pending never opens, the demo switch opens everything, no free list means fully free`() {
        val pending = AccessPolicy.forTrack(Subject.BAHASA, listOf("A"), AccessContext(Entitlements(pending = setOf(Product.PACK_BAHASA))))
        assertFalse(pending.allows("B"))
        assertTrue(AccessPolicy.forTrack(Subject.BAHASA, listOf("A"), AccessContext(unlockAll = true)).allows("B"))
        assertTrue(AccessPolicy.forTrack(Subject.SAINS, emptyList(), AccessContext()).allows("09"))
    }

    @Test
    fun `every bundled track has free units that exist in its pack`() {
        TestPacks.catalog.forEach { t ->
            assertTrue(t.track, t.freeUnits.isNotEmpty())
            val units = t.content.items.map { it.unit }.toSet()
            t.freeUnits.forEach { assertTrue("${t.track} free unit $it", it in units) }
            val free = SessionContent.playable(t.content, AccessPolicy.forTrack(t, AccessContext())::allows)
            assertFalse("${t.track}: a free learner must never meet an empty track", free.empty)
        }
    }

    @Test
    fun `the adult gate needs the right product and a hold`() {
        val g = AdultGate(7, 8)
        assertFalse(g.solved)
        assertFalse(g.copy(answer = "54").solved)
        assertTrue(g.copy(answer = " 56 ").solved)
        repeat(50) {
            val n = AdultGate.next(Random(it))
            assertTrue(n.a in 6..9 && n.b in 3..9)
        }
    }

    private class FakeStore(
        child: Boolean,
    ) : StoreDataSource {
        val data =
            MutableStateFlow(
                StoreData(
                    items = listOf(StoreItem(Product.ALL_ACCESS, "Rp 149.000", owned = false, pending = false)),
                    pricesAvailable = true,
                    childProfile = child,
                    demo = false,
                    unlockAll = false,
                ),
            )
        val noticeFlow = MutableSharedFlow<BillingNotice>(extraBufferCapacity = 4)
        var restored = 0

        override fun observe(): Flow<StoreData> = data

        override val notices: Flow<BillingNotice> = noticeFlow

        override suspend fun refresh() = Unit

        override suspend fun buy(
            activity: Activity,
            product: Product,
        ) = Unit

        override suspend fun restore() {
            restored++
        }
    }

    @Test
    fun `a child profile meets the gate first, an adult does not`() {
        val kidStore = StoreViewModel(FakeStore(child = true))
        val gate = requireNotNull(kidStore.state.value.gate)
        kidStore.onEvent(StoreEvent.GateConfirmed)
        assertNotNull("an unsolved gate stays", kidStore.state.value.gate)
        kidStore.onEvent(StoreEvent.GateAnswer("${gate.a * gate.b}"))
        kidStore.onEvent(StoreEvent.GateConfirmed)
        assertNull(kidStore.state.value.gate)
        assertTrue(kidStore.state.value.gatePassed)

        val adultStore = StoreViewModel(FakeStore(child = false))
        assertNull(adultStore.state.value.gate)
    }

    @Test
    fun `restore and Play notices reach the store`() {
        val fake = FakeStore(child = false)
        val vm = StoreViewModel(fake)
        vm.onEvent(StoreEvent.Restore)
        assertEquals(1, fake.restored)
        fake.noticeFlow.tryEmit(BillingNotice.NothingToRestore)
        assertEquals(BillingNotice.NothingToRestore, vm.state.value.notice)
        vm.onEvent(StoreEvent.NoticeShown)
        assertNull(vm.state.value.notice)
    }

    // ---- daily puzzle ----

    @Test
    fun `the daily puzzle is stable for a day and walks through every puzzle`() {
        val candidates = DailyPuzzle.candidates(TestPacks.catalog, kid)
        assertTrue(candidates.isNotEmpty())
        assertTrue(candidates.all { it.item.type == ItemType.DAILY_PUZZLE && it.item.pool == Pool.SPARE })
        assertTrue("kids get kids' puzzles", candidates.all { TestPacks.track(it.track).pack.meta.audiences.contains(kid.audience) })
        val first = DailyPuzzle.pick(candidates, "2026-10-17", kid.id)
        assertEquals(first, DailyPuzzle.pick(candidates.reversed(), "2026-10-17", kid.id))
        val start = LocalDate.parse("2026-10-17")
        val seen = (0L until candidates.size.toLong()).map { DailyPuzzle.pick(candidates, start.plusDays(it).toString(), kid.id) }.toSet()
        assertEquals(candidates.size, seen.size)
        assertNull(DailyPuzzle.pick(emptyList(), "2026-10-17", kid.id))
        assertEquals("dont_know", DailyPuzzle.outcomeWord(Outcome.DONT_KNOW))
    }

    @Test
    fun `adults and kids draw from their own subjects`() {
        val kids = DailyPuzzle.candidates(TestPacks.catalog, kid).map { it.track }.toSet()
        val adults = DailyPuzzle.candidates(TestPacks.catalog, adult).map { it.track }.toSet()
        assertTrue(kids.isNotEmpty() && adults.isNotEmpty())
        assertTrue(kids.intersect(adults).isEmpty())
    }

    // ---- speed round, stickers, gems, progress ----

    private fun answered(
        track: String,
        itemIds: Collection<String>,
        outcome: Outcome = Outcome.CORRECT,
    ): List<AnswerEvent> {
        val t = TestPacks.track(track)
        return itemIds.mapIndexed { i, id ->
            val item = t.content.item(id)
            AnswerEvent(
                answerId = "a$i",
                learnerId = adult.id,
                itemId = id,
                track = track,
                contentVersion = item.contentVersion,
                rulesVersion = t.rules.rulesVersion,
                appVersion = "test",
                timestamp = "2026-10-17T02:00:00Z",
                localDate = "2026-10-17",
                sessionId = "ses-1",
                lang = Lang.ID,
                pool = item.pool,
                unit = item.unit,
                skills = item.skills,
                rawResponse = "{}",
                autoScore = emptyMap(),
                outcome = outcome,
                firstAttempt = true,
                freshEvidence = false,
                reviewStatus = item.reviewStatus,
                itemType = item.type,
                gem = item.gem,
            )
        }
    }

    @Test
    fun `speed rounds replay only seen choice and number questions, for adults on casual tracks`() {
        val t = TestPacks.track("mat-a")
        val content = SessionContent.playable(t.content)
        val eligible = content.items.filter { SpeedRound.eligible(it) }
        assertTrue(eligible.size >= SpeedRound.SIZE)
        val history = answered("mat-a", eligible.take(6).map { it.itemId })
        val picked = SpeedRound.pick(content, history, Random(1))
        assertEquals(6, picked.size)
        assertTrue(picked.all { p -> history.any { it.itemId == p.itemId } })
        assertTrue(SpeedRound.offered(adult, TrackMode.CASUAL, content, history))
        assertFalse(SpeedRound.offered(kid, TrackMode.CASUAL, content, history))
        assertFalse(SpeedRound.offered(adult, TrackMode.EVIDENCE, content, history))
        assertFalse(SpeedRound.offered(adult, TrackMode.CASUAL, content, history.take(SpeedRound.MIN_ITEMS - 1)))
    }

    @Test
    fun `a sticker is earned by finishing the unit challenge, which opens once the practice is done`() {
        val t = TestPacks.track("mat")
        val content = SessionContent.playable(t.content)
        val unit = t.pack.units.first()
        val practice = UnitPicks.practice(content, unit.unit, kid.audience)
        assertTrue(practice.size > 1)
        val open = { _: String -> true }
        val partly = UnitPicks.rows(t.pack.units, content, answered("mat", practice.drop(1).map { it.itemId }), kid.audience, Lang.EN, open, emptySet())
        assertFalse(partly.first { it.unit == unit.unit }.challengeReady)
        // Any answer counts, "I don't know yet" too.
        val all = answered("mat", practice.map { it.itemId }, outcome = Outcome.DONT_KNOW)
        val rows = UnitPicks.rows(t.pack.units, content, all, kid.audience, Lang.EN, open, emptySet())
        assertTrue(rows.first { it.unit == unit.unit }.challengeReady)
        // Practice alone earns nothing; the finished challenge does.
        assertTrue(Collections.stickers(t.pack.units, Lang.EN, emptySet()).none { it.earned })
        val shelf = Collections.stickers(t.pack.units, Lang.EN, setOf(unit.unit))
        assertEquals(t.pack.units.count { it.sticker != null }, shelf.size)
        assertEquals(listOf(unit.unit), shelf.filter { it.earned }.map { it.unit })
        assertEquals(unit.title.resolve(Lang.EN), shelf.first().unitTitle)
    }

    @Test
    fun `gems collect once each, with their source`() {
        val t = TestPacks.track("mat")
        val gems = t.content.items.filter { it.gem && it.pool == Pool.GEM }
        assertTrue(gems.isNotEmpty())
        val history = answered("mat", listOf(gems.first().itemId, gems.first().itemId))
        val box = Collections.gems(t.content, history, Lang.ID, "Matematika")
        assertEquals(1, box.size)
        assertNotNull(box.first().source)
        assertEquals(gems.first().modelAnswer?.resolve(Lang.ID), box.first().text)
    }

    @Test
    fun `daily puzzle skills are not counted as taught skills`() {
        val t = TestPacks.track("mat-a")
        val notTaught = setOf(Pool.SPARE, Pool.GEM, Pool.FOCUS)
        val taught = t.content.items.filter { it.pool !in notTaught }.flatMap { it.skills }.toSet()
        val spareOnly = t.content.items.filter { it.pool == Pool.SPARE }.flatMap { it.skills }.toSet() - taught
        assertTrue("the bundled puzzles have their own skill ids", spareOnly.isNotEmpty())
        // Even on content that still holds the puzzles, "x of y skills" counts only taught skills.
        assertEquals(taught.size, ProgressCalculator.compute(emptyList(), t.rules, t.content).learned.of)
    }
}
