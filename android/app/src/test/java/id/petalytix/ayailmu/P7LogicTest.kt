package id.petalytix.ayailmu

import androidx.lifecycle.SavedStateHandle
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.TrialConfig
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.collection.GardenLayout
import id.petalytix.ayailmu.feature.consent.Consent
import id.petalytix.ayailmu.feature.session.Reports
import id.petalytix.ayailmu.feature.session.SessionContent
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.store.Access
import id.petalytix.ayailmu.feature.trial.SurveyDataSource
import id.petalytix.ayailmu.feature.trial.SurveyEvent
import id.petalytix.ayailmu.feature.trial.SurveyForms
import id.petalytix.ayailmu.feature.trial.SurveyKind
import id.petalytix.ayailmu.feature.trial.SurveyRules
import id.petalytix.ayailmu.feature.trial.SurveyViewModel
import id.petalytix.ayailmu.feature.trial.TesterCode
import id.petalytix.ayailmu.feature.units.ChallengeUiState
import id.petalytix.ayailmu.feature.units.UnitChallengeViewModel
import id.petalytix.ayailmu.feature.units.UnitPicks
import id.petalytix.ayailmu.feature.units.UnitPlayDataSource
import id.petalytix.ayailmu.feature.units.UnitPlaySetup
import id.petalytix.ayailmu.feature.units.UnitPreviewUiState
import id.petalytix.ayailmu.feature.units.UnitPreviewViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.float
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import kotlin.random.Random

/** P7 closed-test kit and the P6 units/challenge/garden rules: everything that is not drawing. */
@OptIn(ExperimentalCoroutinesApi::class)
class P7LogicTest {
    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private val kid = TestPacks.profile(id = "lrn-kid", kind = ProfileKind.ANAK)
    private val adult = TestPacks.profile(id = "lrn-adult", kind = ProfileKind.ADULT).copy(consentVersion = Consent.VERSION)

    private fun day(s: String): LocalDate = LocalDate.parse(s)

    private fun events(
        track: String,
        itemIds: Collection<String>,
        dates: List<String> = listOf("2026-10-17"),
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
                localDate = dates[i % dates.size],
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
                reviewStatus = item.reviewStatus,
                itemType = item.type,
                gem = item.gem,
            )
        }
    }

    // ---- trial surveys (Trial_App_Spec section 4 step 10) ----

    @Test
    fun `the day-7 survey waits for seven days and three practice days`() {
        val first = day("2026-10-01")
        assertNull(SurveyRules.due(day("2026-10-07"), first, 5, emptySet(), 7, null))
        assertEquals(SurveyKind.DAY7, SurveyRules.due(day("2026-10-08"), first, 3, emptySet(), 7, null))
        assertNull(SurveyRules.due(day("2026-10-08"), first, 2, emptySet(), 7, null))
        assertNull(SurveyRules.due(day("2026-10-20"), first, 9, setOf(SurveyKind.DAY7), 7, null))
        assertNull(SurveyRules.due(day("2026-10-20"), null, 0, emptySet(), 7, null))
        // "Nanti saja" hides it for the rest of the day.
        assertNull(SurveyRules.due(day("2026-10-08"), first, 3, emptySet(), 7, null, snoozedToday = true))
    }

    @Test
    fun `the end-of-trial survey replaces day 7 once its date has come`() {
        val first = day("2026-10-01")
        val end = day("2026-10-30")
        assertEquals(SurveyKind.DAY7, SurveyRules.due(day("2026-10-29"), first, 4, emptySet(), 7, end))
        assertEquals(SurveyKind.END, SurveyRules.due(day("2026-10-30"), first, 1, emptySet(), 7, end))
        assertEquals(SurveyKind.END, SurveyRules.due(day("2026-11-02"), first, 4, setOf(SurveyKind.DAY7), 7, end))
        assertNull(SurveyRules.due(day("2026-11-02"), first, 4, setOf(SurveyKind.END), 7, end))
    }

    @Test
    fun `only a consented adult is asked, counting practice days on the trial track`() {
        val trial = TrialConfig(track = "arab", surveyDay = 7, endSurveyFrom = null, testerCodeHashes = emptyList(), testerUntil = null)
        val arab = TestPacks.track("arab")
        val ids = arab.content.items.take(3).map { it.itemId }
        val history = events("arab", ids, dates = listOf("2026-10-01", "2026-10-03", "2026-10-05"))
        val today = day("2026-10-09")
        val bg = setOf(SurveyKind.BACKGROUND)
        assertEquals(SurveyKind.DAY7, SurveyRules.forProfile(adult, trial, history, bg, today))
        assertNull(SurveyRules.forProfile(adult.copy(consentVersion = null), trial, history, bg, today))
        assertNull(SurveyRules.forProfile(kid, trial, history, bg, today))
        assertNull(SurveyRules.forProfile(adult, trial, history.take(2), bg, today))
        // Consented without reaching the background questions: they come first, from day one.
        assertEquals(SurveyKind.BACKGROUND, SurveyRules.forProfile(adult, trial, emptyList(), emptySet(), today))
        assertNull(SurveyRules.forProfile(adult, trial, emptyList(), emptySet(), today, snoozedToday = true))
        assertNull(SurveyRules.forProfile(kid, trial, emptyList(), emptySet(), today))
    }

    @Test
    fun `stored survey answers keep only known questions and options`() {
        val cleaned =
            SurveyForms.clean(
                SurveyKind.BACKGROUND,
                mapOf(
                    "e_b1" to listOf("self", "nonsense", "tpa"),
                    "e_b2" to listOf("weekly", "daily"),
                    "e_b3" to emptyList(),
                    "e_b4" to listOf("15"),
                    "injected" to listOf("x"),
                ),
            )
        assertEquals(mapOf("e_b1" to listOf("tpa", "self"), "e_b2" to listOf("weekly"), "e_b4" to listOf("15")), cleaned)
        assertEquals(15, SurveyForms.sessionMinutes(cleaned))
        val long = "x".repeat(SurveyForms.MAX_TEXT + 40)
        val trial = SurveyForms.clean(SurveyKind.DAY7, mapOf("hardest" to listOf("  $long  "), "confusing" to listOf("   "), "clarity" to listOf("9")))
        assertEquals(SurveyForms.MAX_TEXT, trial.getValue("hardest").single().length)
        assertFalse(trial.containsKey("confusing"))
        assertFalse(trial.containsKey("clarity"))
    }

    private class FakeSurveys(
        val profile: Profile?,
        val already: Set<SurveyKind> = emptySet(),
    ) : SurveyDataSource {
        val saved = mutableListOf<Pair<SurveyKind, Map<String, List<String>>>>()
        var minutes: Int? = null
        var snoozed = 0
        var failMinutes = false

        override suspend fun profile(): Profile? = profile

        override suspend fun done(
            profileId: String,
            track: String,
        ): Set<SurveyKind> = already

        override suspend fun save(
            profileId: String,
            track: String,
            kind: SurveyKind,
            answers: Map<String, List<String>>,
        ) {
            saved += kind to answers
        }

        override suspend fun setSessionMinutes(
            profileId: String,
            minutes: Int,
        ) {
            if (failMinutes) error("disk full")
            this.minutes = minutes
        }

        override suspend fun snooze(profileId: String) {
            snoozed++
        }
    }

    private fun surveyVm(
        kind: SurveyKind,
        data: FakeSurveys,
    ) = SurveyViewModel(SavedStateHandle(mapOf("kind" to kind.code, "track" to "arab")), data)

    @Test
    fun `background answers are saved once and E-B4 sets the session length`() {
        val data = FakeSurveys(adult)
        val vm = surveyVm(SurveyKind.BACKGROUND, data)
        vm.onEvent(SurveyEvent.Choose("e_b1", "iqra"))
        vm.onEvent(SurveyEvent.Choose("e_b1", "tpa"))
        vm.onEvent(SurveyEvent.Choose("e_b4", "10"))
        vm.onEvent(SurveyEvent.Choose("e_b4", "20")) // single choice: the second replaces the first
        vm.onEvent(SurveyEvent.Submit)
        assertTrue(vm.state.value.done)
        assertEquals(listOf(SurveyKind.BACKGROUND to mapOf("e_b1" to listOf("tpa", "iqra"), "e_b4" to listOf("20"))), data.saved)
        assertEquals(20, data.minutes)
    }

    @Test
    fun `background answers stay saved once when only the session length fails`() {
        val data = FakeSurveys(adult).apply { failMinutes = true }
        val vm = surveyVm(SurveyKind.BACKGROUND, data)
        vm.onEvent(SurveyEvent.Choose("e_b4", "15"))
        vm.onEvent(SurveyEvent.Submit)
        assertTrue(vm.state.value.done)
        assertFalse(vm.state.value.failed)
        vm.onEvent(SurveyEvent.Submit)
        assertEquals(1, data.saved.size)
        assertNull(data.minutes)
    }

    @Test
    fun `skipping the background stores an empty answer, skipping a survey snoozes it for today`() {
        val bg = FakeSurveys(adult)
        surveyVm(SurveyKind.BACKGROUND, bg).onEvent(SurveyEvent.Skip)
        assertEquals(listOf(SurveyKind.BACKGROUND to emptyMap<String, List<String>>()), bg.saved)
        assertNull(bg.minutes)

        val d7 = FakeSurveys(adult)
        val vm = surveyVm(SurveyKind.DAY7, d7)
        vm.onEvent(SurveyEvent.Skip)
        assertTrue(vm.state.value.done)
        assertTrue(d7.saved.isEmpty())
        assertEquals(1, d7.snoozed)
        assertEquals(0, bg.snoozed)

        // Answered before (e.g. consent given again after a text change): the form just moves on.
        assertTrue(surveyVm(SurveyKind.BACKGROUND, FakeSurveys(adult, already = setOf(SurveyKind.BACKGROUND))).state.value.done)
    }

    // ---- tester codes (CR-BIL-7) ----

    @Test
    fun `tester codes compare SHA-256 hashes after trimming and upper-casing`() {
        // The same value as `python3 android/tools/tester_code.py --hash AYA-ABCDE-FGHJK-LMNPQ-RSTUV`.
        val hash = "da89720d8b1969c4d89e6bfc1db1f845177776e16b9c09f1e49ab18067a682d4"
        assertEquals(hash, TesterCode.hash("AYA-ABCDE-FGHJK-LMNPQ-RSTUV"))
        assertTrue(TesterCode.matches("  aya-abcde-fghjk-lmnpq-rstuv ", listOf(hash)))
        assertFalse(TesterCode.matches("AYA-ABCDE-FGHJK-LMNPQ-RSTUW", listOf(hash)))
        assertFalse(TesterCode.matches("   ", listOf(TesterCode.hash(""))))
    }

    @Test
    fun `tester codes open units only until tester_until, and only while the build lists some`() {
        val trial = TrialConfig(track = "arab", surveyDay = 7, endSurveyFrom = null, testerCodeHashes = listOf("a".repeat(64)), testerUntil = "2026-12-31")
        assertTrue(trial.testerOpen(day("2026-12-31")))
        assertFalse(trial.testerOpen(day("2027-01-01")))
        assertFalse(trial.copy(testerCodeHashes = emptyList()).testerOpen(day("2026-11-01")))
        assertFalse(trial.copy(testerUntil = null).testerOpen(day("2026-11-01")))
        // Hashes without an end date make the trial block invalid (the trial features stay off).
        assertEquals(1, trial.copy(testerUntil = null).problems().size)
        assertEquals(emptyList<String>(), trial.problems())
    }

    @Test
    fun `a tester code opens everything only in the developer build`() {
        assertFalse(Access.unlockAll(tester = true, developerDemo = false, simulateFreeTier = false))
        assertTrue(Access.unlockAll(tester = true, developerDemo = true, simulateFreeTier = true))
        assertTrue(Access.unlockAll(tester = false, developerDemo = true, simulateFreeTier = false))
        assertFalse(Access.unlockAll(tester = false, developerDemo = true, simulateFreeTier = true))
        assertFalse(Access.unlockAll(tester = false, developerDemo = false, simulateFreeTier = false))
    }

    // ---- reports (Trial_App_Spec section 7) ----

    @Test
    fun `reports keep a known reason, and free text only from adults`() {
        assertEquals("typo" to "ada salah", Reports.clean("typo", "  ada salah ", child = false))
        assertEquals("other" to "", Reports.clean("other", "nama saya Sari", child = true))
        assertEquals(Reports.MAX_TEXT, Reports.clean("confusing", "y".repeat(400), child = false)!!.second.length)
        assertNull(Reports.clean("spam", "", child = false))
    }

    // ---- units, preview and challenge (P5 free tier, P6) ----

    @Test
    fun `units list every unit, locked ones included, with answered counts`() {
        val t = TestPacks.track("mat")
        val content = SessionContent.playable(t.content)
        val practice01 = UnitPicks.practice(content, "01", kid.audience)
        val history = events("mat", practice01.take(2).map { it.itemId })
        val rows = UnitPicks.rows(t.pack.units, content, history, kid.audience, Lang.ID, { it == "01" }, emptySet())
        assertEquals(t.pack.units.map { it.unit }, rows.map { it.unit })
        val first = rows.first()
        assertFalse(first.locked)
        assertEquals(2, first.answered)
        assertEquals(practice01.size, first.total)
        assertFalse(first.challengeReady)
        assertTrue(rows.drop(1).all { it.locked && !it.challengeReady })
        assertEquals(t.pack.units.first().title.resolve(Lang.ID), first.title)
        // A finished challenge shows as done and is not offered again.
        val all = events("mat", practice01.map { it.itemId })
        assertTrue(UnitPicks.rows(t.pack.units, content, all, kid.audience, Lang.ID, { true }, emptySet()).first().challengeReady)
        val done = UnitPicks.rows(t.pack.units, content, all, kid.audience, Lang.ID, { true }, setOf("01")).first()
        assertTrue(done.challengeDone)
        assertFalse(done.challengeReady)
    }

    @Test
    fun `a pack without a unit list shows the units its questions use`() {
        val t = TestPacks.track("arab")
        val rows = UnitPicks.rows(t.pack.units, SessionContent.playable(t.content), emptyList(), adult.audience, Lang.ID, { true }, emptySet())
        assertEquals(listOf("A"), rows.map { it.unit })
        assertNull(rows.single().title)
    }

    @Test
    fun `the preview is one stable question from the unit that needs no typing`() {
        val t = TestPacks.track("mat")
        val content = SessionContent.playable(t.content)
        val item = assertNotNullItem(UnitPicks.previewItem(content, "02", kid.audience))
        assertEquals("02", item.unit)
        assertNull(item.readingId)
        assertTrue(StepMapper.kindOf(item).name !in setOf("TYPED", "PARAPHRASE", "INFO", "GEM", "UNSUPPORTED"))
        assertEquals(item.itemId, UnitPicks.previewItem(content, "02", kid.audience)?.itemId)
    }

    private fun assertNotNullItem(item: Item?): Item {
        assertNotNull(item)
        return item!!
    }

    @Test
    fun `the challenge asks up to five seen quick questions of the unit`() {
        val t = TestPacks.track("mat-a")
        val content = SessionContent.playable(t.content)
        val practice = UnitPicks.practice(content, "01", adult.audience)
        val history = events("mat-a", practice.map { it.itemId })
        val picked = UnitPicks.challengeItems(content, "01", adult.audience, history, Random(3))
        assertEquals(UnitPicks.CHALLENGE_SIZE, picked.size)
        assertTrue(picked.all { it.unit == "01" && it.itemId in history.map { e -> e.itemId } && it.readingId == null })
        assertTrue(picked.all { StepMapper.kindOf(it).name in setOf("CHOICE", "NUMBER", "HOTSPOT", "SLIDER") })
        assertTrue(UnitPicks.challengeItems(content, "01", adult.audience, emptyList(), Random(3)).isEmpty())
    }

    private class FakePlay(
        val setup: UnitPlaySetup?,
    ) : UnitPlayDataSource {
        val completed = mutableListOf<String>()

        override suspend fun preview(
            track: String,
            unit: String,
        ) = setup

        override suspend fun challenge(
            track: String,
            unit: String,
        ) = setup

        override suspend fun complete(
            profileId: String,
            track: String,
            unit: String,
        ) {
            completed += unit
        }
    }

    private fun playSetup(items: Int): UnitPlaySetup {
        val t = TestPacks.track("mat-a")
        val content = SessionContent.playable(t.content)
        val practice = UnitPicks.practice(content, "01", adult.audience)
        val history = events("mat-a", practice.map { it.itemId })
        val picked = UnitPicks.challengeItems(content, "01", adult.audience, history, Random(1)).take(items)
        return UnitPlaySetup(adult, "01", "Bilangan", "sticker_teapot", content, t.rules, null, picked, null)
    }

    @Test
    fun `finishing the challenge records it once, whatever the answers`() {
        val data = FakePlay(playSetup(UnitPicks.CHALLENGE_SIZE))
        val vm = UnitChallengeViewModel(SavedStateHandle(mapOf("track" to "mat-a", "unit" to "01")), data)
        repeat(UnitPicks.CHALLENGE_SIZE) { i ->
            val running = vm.state.value as ChallengeUiState.Running
            assertEquals(i + 1, running.position)
            vm.next() // ignored before an answer
            assertEquals(i + 1, (vm.state.value as ChallengeUiState.Running).position)
            vm.onAnswerDontKnow()
            assertNotNull((vm.state.value as ChallengeUiState.Running).play.feedback)
            vm.next()
        }
        val done = vm.state.value as ChallengeUiState.Done
        assertEquals("sticker_teapot", done.sticker)
        assertEquals(listOf("01"), data.completed)
        // Recorded, so the sticker is earned: the screen may play the sticker sound now (follow-up 11).
        assertTrue(done.saved)
        assertFalse(done.saveFailed)
    }

    @Test
    fun `a challenge that could not be recorded earns no sticker sound`() {
        val data =
            object : UnitPlayDataSource by FakePlay(playSetup(1)) {
                override suspend fun complete(
                    profileId: String,
                    track: String,
                    unit: String,
                ): Unit = throw IllegalStateException("disk full")
            }
        val vm = UnitChallengeViewModel(SavedStateHandle(mapOf("track" to "mat-a", "unit" to "01")), data)
        vm.onAnswerDontKnow()
        vm.next()
        val done = vm.state.value as ChallengeUiState.Done
        assertTrue(done.saveFailed)
        assertFalse(done.saved)
    }

    private fun UnitChallengeViewModel.onAnswerDontKnow() = answer(Response.dontKnow())

    @Test
    fun `a challenge that is not open says so and records nothing`() {
        val data = FakePlay(null)
        val vm = UnitChallengeViewModel(SavedStateHandle(mapOf("track" to "mat-a", "unit" to "01")), data)
        assertEquals(ChallengeUiState.NotReady, vm.state.value)
        assertTrue(data.completed.isEmpty())
    }

    @Test
    fun `the preview scores one answer in memory`() {
        val vm = UnitPreviewViewModel(SavedStateHandle(mapOf("track" to "mat-a", "unit" to "01")), FakePlay(playSetup(1)))
        val ready = vm.state.value as UnitPreviewUiState.Ready
        assertNull(ready.play.feedback)
        vm.answer(Response.dontKnow())
        assertEquals(Outcome.DONT_KNOW, (vm.state.value as UnitPreviewUiState.Ready).play.feedback?.outcome)
    }

    // ---- Kebun Ilmu garden ----

    @Test
    fun `small tracks use the front row, bigger ones fill the back row first`() {
        assertEquals(listOf("plot_06", "plot_07"), GardenLayout.plotsFor(2).map { it.id })
        assertEquals((6..10).map { "plot_%02d".format(it) }, GardenLayout.plotsFor(5).map { it.id })
        assertEquals((1..7).map { "plot_%02d".format(it) }, GardenLayout.plotsFor(7).map { it.id })
        assertEquals(GardenLayout.MAX_PLOTS, GardenLayout.plotsFor(14).size)
        assertTrue(GardenLayout.plotsFor(0).isEmpty())
    }

    @Test
    fun `garden plots match the art index regions`() {
        val stream = javaClass.classLoader!!.getResourceAsStream("art/index.json")
        assumeTrue("art/index.json not bundled", stream != null)
        val index = Json.parseToJsonElement(stream!!.use { it.readBytes().decodeToString() }).jsonObject
        val regions = index["regions"]?.jsonObject?.get(GardenLayout.SCENE)?.jsonObject
        assumeTrue("scene_garden regions not drawn yet", regions != null)
        assertEquals(GardenLayout.PLOTS.map { it.id }.toSet(), regions!!.keys)
        GardenLayout.PLOTS.forEach { p ->
            val r = regions.getValue(p.id).jsonObject
            assertEquals(p.id, r.getValue("x").jsonPrimitive.float, p.x, 0.001f)
            assertEquals(p.id, r.getValue("y").jsonPrimitive.float, p.y, 0.001f)
            assertEquals(p.id, r.getValue("w").jsonPrimitive.float, p.w, 0.001f)
            assertEquals(p.id, r.getValue("h").jsonPrimitive.float, p.h, 0.001f)
        }
    }
}
