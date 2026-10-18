package id.petalytix.ayailmu

import androidx.lifecycle.SavedStateHandle
import id.petalytix.ayailmu.core.billing.Entitlements
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.settings.ModuleChoice
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.ReviewStatus
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.home.Avatars
import id.petalytix.ayailmu.feature.home.fits
import id.petalytix.ayailmu.feature.modules.ModuleCard
import id.petalytix.ayailmu.feature.modules.ModuleDataSource
import id.petalytix.ayailmu.feature.modules.ModuleDetail
import id.petalytix.ayailmu.feature.modules.ModuleEvent
import id.petalytix.ayailmu.feature.modules.ModuleLanguage
import id.petalytix.ayailmu.feature.modules.ModuleModel
import id.petalytix.ayailmu.feature.modules.ModuleScreenData
import id.petalytix.ayailmu.feature.modules.ModuleUiState
import id.petalytix.ayailmu.feature.modules.ModuleView
import id.petalytix.ayailmu.feature.modules.ModuleViewModel
import id.petalytix.ayailmu.feature.modules.TrackFacts
import id.petalytix.ayailmu.feature.modules.artKey
import id.petalytix.ayailmu.feature.modules.moduleOf
import id.petalytix.ayailmu.feature.store.AccessContext
import id.petalytix.ayailmu.feature.store.AccessPolicy
import id.petalytix.ayailmu.feature.store.DefaultStoreDataSource
import id.petalytix.ayailmu.feature.store.coverKey
import id.petalytix.ayailmu.feature.store.isFree
import id.petalytix.ayailmu.feature.units.UnitPicks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Follow-up 12: modules, languages, the level ladder, the next-level suggestion, avatars and the new packs. */
@OptIn(ExperimentalCoroutinesApi::class)
class ModulesTest {
    private fun t(
        track: String,
        subject: Subject,
        level: Level = Level.PEMULA,
        language: String? = null,
        done: Int = 0,
        total: Int = 5,
        last: Long? = null,
    ) = TrackFacts(track, subject, level, language, unitsDone = done, unitsTotal = total, lastActiveMs = last)

    private val adultShelf =
        listOf(
            t("arab", Subject.BAHASA, language = "ar"),
            t("ing-a", Subject.BAHASA, language = "en"),
            t("kor-a", Subject.BAHASA, language = "ko"),
            t("kor-a-m", Subject.BAHASA, Level.MENENGAH, language = "ko", total = 2),
            t("mat-a", Subject.MATEMATIKA, total = 10),
            t("mat-a-m", Subject.MATEMATIKA, Level.MENENGAH, total = 2),
            t("nil-a", Subject.NILAI, total = 3),
        )

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `tracks group into one module each, in shelf order, and a module without tracks is not shown`() {
        val modules = ModuleModel.modules(adultShelf, Audience.ADULTS, emptyMap())
        assertEquals(listOf(Subject.BAHASA, Subject.MATEMATIKA, Subject.NILAI), modules.map { it.subject })
        modules.forEach { assertEquals(Level.entries, it.ladder.map { r -> r.level }) }
        assertTrue(modules.filter { it.subject != Subject.BAHASA }.all { it.languages.isEmpty() && it.language == null })
    }

    @Test
    fun `Bahasa lists its languages in picker order and children never see Arabic`() {
        val adults = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, null)!!
        assertEquals(listOf(ModuleLanguage.ARAB, ModuleLanguage.INGGRIS, ModuleLanguage.KOREA), adults.languages.map { it.language })
        val kidShelf = listOf(t("arab-k", Subject.BAHASA, language = "ar"), t("ing-k", Subject.BAHASA, language = "en"))
        val kids = ModuleModel.module(Subject.BAHASA, kidShelf, Audience.KIDS, ModuleChoice(language = "ar"))!!
        assertEquals(listOf(ModuleLanguage.INGGRIS), kids.languages.map { it.language })
        assertEquals(ModuleLanguage.INGGRIS, kids.language)
        assertEquals("ing-k", kids.track)
        // Only Arabic on a child's shelf: no Bahasa card at all rather than a dead one.
        assertNull(ModuleModel.module(Subject.BAHASA, kidShelf.take(1), Audience.KIDS, null))
        // A Bahasa pack whose target language the picker does not know is left out.
        assertNull(ModuleModel.module(Subject.BAHASA, listOf(t("xx-k", Subject.BAHASA, language = "xx")), Audience.KIDS, null))
    }

    @Test
    fun `a level without a track is coming soon and cannot be chosen`() {
        val view = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, ModuleChoice("ko", "M"))!!
        assertEquals(listOf("kor-a", "kor-a-m", null, null), view.ladder.map { it.track })
        assertEquals(listOf(false, false, true, true), view.ladder.map { it.comingSoon })
        assertEquals(Level.MENENGAH, view.level)
        assertEquals("kor-a-m", view.track)
        assertTrue(view.chosenRung.chosen)
        assertNull(ModuleModel.chooseLevel(view, Level.MAHIR))
        assertEquals(ModuleChoice("ko", "P"), ModuleModel.chooseLevel(view, Level.PEMULA))
    }

    @Test
    fun `a stored choice wins while it has a track, otherwise the language and level fall back`() {
        val ko = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, ModuleChoice("ko", "M"))!!
        assertEquals(ModuleLanguage.KOREA to Level.MENENGAH, ko.language to ko.level)
        // English has no Menengah track: the level falls back to the lowest one English has.
        val en = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, ModuleChoice("en", "M"))!!
        assertEquals(ModuleLanguage.INGGRIS to Level.PEMULA, en.language to en.level)
        // A language this shelf no longer has, and a level code a later version might write.
        val gone = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, ModuleChoice("de", "Z"))!!
        assertEquals(ModuleLanguage.ARAB to Level.PEMULA, gone.language to gone.level)
        val mat = ModuleModel.module(Subject.MATEMATIKA, adultShelf, Audience.ADULTS, ModuleChoice(level = "M"))!!
        assertEquals("mat-a-m", mat.track)
    }

    @Test
    fun `without a choice the track practised last decides, then the first language and the lowest level`() {
        val shelf =
            adultShelf.map {
                when (it.track) {
                    "ing-a" -> it.copy(lastActiveMs = 1_000L)
                    "kor-a-m" -> it.copy(lastActiveMs = 5_000L)
                    else -> it
                }
            }
        val view = ModuleModel.module(Subject.BAHASA, shelf, Audience.ADULTS, null)!!
        assertEquals(ModuleLanguage.KOREA to Level.MENENGAH, view.language to view.level)
        val fresh = ModuleModel.module(Subject.MATEMATIKA, adultShelf, Audience.ADULTS, null)!!
        assertEquals(Level.PEMULA, fresh.level)
        // A choice of language alone keeps that language; the level comes from what was practised in it last.
        val chosenEnglish = ModuleModel.module(Subject.BAHASA, shelf, Audience.ADULTS, ModuleChoice(language = "en"))!!
        assertEquals(ModuleLanguage.INGGRIS to Level.PEMULA, chosenEnglish.language to chosenEnglish.level)
        // Only Menengah exists: it is the lowest level with a track.
        val onlyMiddle = ModuleModel.module(Subject.SAINS, listOf(t("sns-a-m", Subject.SAINS, Level.MENENGAH)), Audience.ADULTS, null)!!
        assertEquals(Level.MENENGAH, onlyMiddle.level)
    }

    @Test
    fun `the next level is suggested once 80 percent of the chosen level's units are done`() {
        assertTrue(ModuleModel.ready(4, 5))
        assertTrue(ModuleModel.ready(8, 10))
        assertTrue(ModuleModel.ready(2, 2))
        assertFalse(ModuleModel.ready(3, 5))
        assertFalse(ModuleModel.ready(1, 2))
        assertFalse(ModuleModel.ready(0, 0))
        val almost = adultShelf.map { if (it.track == "mat-a") it.copy(unitsDone = 8) else it }
        val mat = ModuleModel.module(Subject.MATEMATIKA, almost, Audience.ADULTS, null)!!
        assertEquals(Level.MENENGAH, mat.suggestion)
        assertEquals(listOf(false, true, false, false), mat.ladder.map { it.suggested })
        val seven = adultShelf.map { if (it.track == "mat-a") it.copy(unitsDone = 7) else it }
        val notYet = ModuleModel.module(Subject.MATEMATIKA, seven, Audience.ADULTS, null)!!
        assertNull(notYet.suggestion)
        // Menengah done but Mahir is «Segera»: nothing to suggest.
        val top = adultShelf.map { if (it.track == "mat-a-m") it.copy(unitsDone = 2) else it }
        assertNull(ModuleModel.module(Subject.MATEMATIKA, top, Audience.ADULTS, ModuleChoice(level = "M"))!!.suggestion)
        val master = listOf(t("mat-a-x", Subject.MATEMATIKA, Level.MASTER, done = 5))
        assertNull(ModuleModel.module(Subject.MATEMATIKA, master, Audience.ADULTS, null)!!.suggestion)
    }

    @Test
    fun `picking a language keeps the level`() {
        val view = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, ModuleChoice("ko", "M"))!!
        assertEquals(ModuleChoice("en", "M"), ModuleModel.chooseLanguage(view, ModuleLanguage.INGGRIS))
    }

    private fun event(
        item: Item,
        track: String,
        ts: String = "2026-10-17T02:00:00Z",
    ) = AnswerEvent(
        answerId = "ans-${item.itemId}",
        learnerId = "lrn-kid",
        itemId = item.itemId,
        track = track,
        contentVersion = "t",
        rulesVersion = "t",
        appVersion = "t",
        timestamp = ts,
        localDate = ts.take(10),
        sessionId = "ses-1",
        lang = Lang.ID,
        pool = item.pool,
        unit = item.unit,
        skills = item.skills,
        rawResponse = "{}",
        autoScore = emptyMap(),
        outcome = Outcome.DONT_KNOW,
        firstAttempt = true,
        freshEvidence = false,
        reviewStatus = ReviewStatus.DRAFT,
        itemType = item.type,
    )

    @Test
    fun `a unit is done when every practice question was answered once, or when its challenge is finished`() {
        val mat = TestPacks.track("mat")
        val kid = TestPacks.profile()
        val content = id.petalytix.ayailmu.feature.session.SessionContent.playable(mat.content)
        val unit1 = UnitPicks.practice(content, "01", kid.audience)
        val half = UnitPicks.practice(content, "02", kid.audience).let { it.take(it.size / 2) }
        val history = unit1.map { event(it, "mat") } + half.map { event(it, "mat", "2026-10-18T03:00:00Z") }
        val access = AccessPolicy.forTrack(mat, AccessContext())
        val facts = ModuleModel.facts(mat, history, completed = setOf("03"), profile = kid, allows = access::allows)
        assertEquals(Subject.MATEMATIKA, facts.subject)
        assertEquals(Level.PEMULA, facts.level)
        // Unit 01 practised through, unit 03 by its finished challenge; unit 02 only half.
        assertEquals(2, facts.unitsDone)
        assertEquals(mat.pack.units.size, facts.unitsTotal)
        // Free tier: only unit 01 is open, but the closed units still count in the total.
        assertEquals(1, facts.unitsOpen)
        assertEquals(java.time.Instant.parse("2026-10-18T03:00:00Z").toEpochMilli(), facts.lastActiveMs)
        assertNull(ModuleModel.facts(mat, emptyList(), emptySet(), kid, access::allows).lastActiveMs)
    }

    @Test
    fun `the bundled catalog makes a Bahasa module for every profile, Arabic for adults only`() {
        val kid = TestPacks.profile(kind = ProfileKind.ANAK)
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        fun modulesFor(p: id.petalytix.ayailmu.core.data.Profile): List<ModuleView> {
            val facts =
                TestPacks.catalog
                    .filter { it.fits(p) }
                    .map { ModuleModel.facts(it, emptyList(), emptySet(), p) { true } }
                    .filter { it.unitsTotal > 0 }
            return ModuleModel.modules(facts, p.audience, emptyMap())
        }
        val kids = modulesFor(kid)
        val adults = modulesFor(adult)
        val kidsBahasa = kids.first { it.subject == Subject.BAHASA }
        assertFalse(kidsBahasa.languages.any { it.language == ModuleLanguage.ARAB })
        assertTrue(adults.first { it.subject == Subject.BAHASA }.languages.any { it.language == ModuleLanguage.ARAB })
        // Nothing practised yet: every module starts at its lowest level with a track, and «Mulai» has a track.
        (kids + adults).forEach { m ->
            assertEquals(m.ladder.first { !it.comingSoon }.level, m.level)
            assertEquals(m.chosenRung.track, m.track)
        }
        assertTrue(kids.map { it.subject }.containsAll(listOf(Subject.BAHASA, Subject.MATEMATIKA, Subject.SAINS, Subject.SOSIAL_SENI)))
    }

    @Test
    fun `module codes, covers, level badges and the free module`() {
        assertEquals(Subject.BAHASA, moduleOf("BHS"))
        assertEquals(Subject.NILAI, moduleOf("NIL"))
        assertEquals(Subject.SEJARAH, moduleOf("SJR"))
        assertNull(moduleOf("bahasa"))
        assertEquals("cover_nilai", Subject.NILAI.coverKey())
        assertEquals("cover_sejarah", Subject.SEJARAH.coverKey())
        assertEquals(listOf("level_pemula", "level_menengah", "level_mahir", "level_master"), Level.entries.map { it.artKey() })
        assertEquals(
            listOf("cover_lang_arab", "cover_lang_inggris", "cover_lang_korea", "cover_lang_jepang", "cover_lang_mandarin"),
            ModuleLanguage.entries.map { it.art },
        )
        assertTrue(Subject.NILAI.isFree)
        assertFalse(Subject.SEJARAH.isFree)
    }

    @Test
    fun `Nilai is fully open, Sejarah opens with its pack or all-access, and only Sejarah joins the store`() {
        val nilai = AccessPolicy.forTrack(Subject.NILAI, listOf("01"), AccessContext())
        assertNull(nilai.product)
        assertTrue(nilai.fullyOpen && nilai.allows("03"))
        val sejarah = AccessPolicy.forTrack(Subject.SEJARAH, listOf("01"), AccessContext())
        assertEquals(Product.PACK_SEJARAH, sejarah.product)
        assertTrue(sejarah.allows("01") && !sejarah.allows("02"))
        fun owning(p: Product) = AccessPolicy.forTrack(Subject.SEJARAH, listOf("01"), AccessContext(Entitlements(owned = setOf(p))))
        assertTrue(owning(Product.PACK_SEJARAH).fullyOpen)
        assertTrue(owning(Product.ALL_ACCESS).fullyOpen)
        assertFalse(owning(Product.PACK_SAINS).fullyOpen)
        assertTrue(Product.PACK_SEJARAH in DefaultStoreDataSource.ORDER)
        assertEquals(Product.entries.toSet(), DefaultStoreDataSource.ORDER.toSet())
        assertTrue(DefaultStoreDataSource.ORDER.none { it.subject == Subject.NILAI })
    }

    @Test
    fun `avatars - a stable default by id, a picked animal wins, an unknown key falls back`() {
        val a = Avatars.defaultFor("lrn-6f1c2a9e")
        assertTrue(a in Avatars.KEYS)
        assertEquals(a, Avatars.defaultFor("lrn-6f1c2a9e"))
        assertEquals("pic_rabbit", Avatars.of("lrn-1", "pic_rabbit"))
        assertEquals(Avatars.defaultFor("lrn-1"), Avatars.of("lrn-1", "letter_u"))
        assertEquals(Avatars.defaultFor("lrn-1"), Avatars.of("lrn-1", null))
        val kid = TestPacks.profile()
        val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT)
        val resolved = Avatars.resolve(listOf(kid, adult), mapOf(kid.id to "pic_duck"))
        assertEquals(mapOf(kid.id to "pic_duck", adult.id to Avatars.defaultFor(adult.id)), resolved)
        // Twelve different animals, all from the shared picture vocabulary.
        assertEquals(12, Avatars.KEYS.toSet().size)
        assertTrue(Avatars.KEYS.all { it.startsWith("pic_") })
    }

    private class FakeModules(
        initial: ModuleScreenData?,
    ) : ModuleDataSource {
        val data = MutableStateFlow(initial)
        val chosen = mutableListOf<Pair<String, ModuleChoice>>()
        var fail = false

        override fun observe(code: String): Flow<ModuleScreenData?> = data

        override suspend fun choose(
            code: String,
            choice: ModuleChoice,
        ) {
            if (fail) error("disk full")
            chosen += code to choice
        }
    }

    private fun screen(choice: ModuleChoice?): ModuleScreenData {
        val view = ModuleModel.module(Subject.BAHASA, adultShelf, Audience.ADULTS, choice)!!
        val card = ModuleCard(Subject.BAHASA, view.language, view.level, view.track, "Bahasa")
        return ModuleScreenData(ModuleDetail(view, card), Audience.ADULTS)
    }

    @Test
    fun `the module screen stores a picked language or level and ignores a coming-soon rung`() {
        val fake = FakeModules(screen(ModuleChoice("ko", "M")))
        val vm = ModuleViewModel(SavedStateHandle(mapOf("code" to "BHS")), fake)
        assertTrue(vm.state.value is ModuleUiState.Ready)
        vm.onEvent(ModuleEvent.PickLanguage(ModuleLanguage.INGGRIS))
        vm.onEvent(ModuleEvent.PickLevel(Level.MAHIR))
        vm.onEvent(ModuleEvent.PickLevel(Level.MENENGAH))
        vm.onEvent(ModuleEvent.PickLevel(Level.PEMULA))
        assertEquals(listOf("BHS" to ModuleChoice("en", "M"), "BHS" to ModuleChoice("ko", "P")), fake.chosen)
    }

    @Test
    fun `an unknown module shows the error picture and a failed save is said, not thrown`() {
        val vm = ModuleViewModel(SavedStateHandle(mapOf("code" to "XXX")), FakeModules(null))
        assertEquals(ModuleUiState.Failed, vm.state.value)
        val fake = FakeModules(screen(null)).apply { fail = true }
        val ready = ModuleViewModel(SavedStateHandle(mapOf("code" to "BHS")), fake)
        ready.onEvent(ModuleEvent.PickLanguage(ModuleLanguage.KOREA))
        assertEquals(true, (ready.state.value as ModuleUiState.Ready).saveFailed)
        // A new emission (e.g. after Refresh) shows the stored choice again without the notice.
        fake.data.value = screen(ModuleChoice("ko", "M"))
        assertEquals(false, (ready.state.value as ModuleUiState.Ready).saveFailed)
    }
}
