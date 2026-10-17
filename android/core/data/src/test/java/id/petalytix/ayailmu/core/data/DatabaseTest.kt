package id.petalytix.ayailmu.core.data

import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ARABIC_SCALE_MAX
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.DataResetter
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.data.settings.InMemoryReminderStore
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.engine.SaveResult
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionController
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * P2 storage behaviour on a real (in-memory) Room database: profiles and their rules, the engine's
 * SessionController persisting through RoomSessionStore, resume, idempotent writes, delete-all.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DatabaseTest {
    private lateinit var db: AyaDatabase
    private val clock = TestSupport.clock()
    private val ids = CountingIdGenerator()
    private val active = InMemoryActiveProfileStore()
    private lateinit var profiles: ProfileRepository
    private lateinit var answers: AnswerRepository

    @Before
    fun setUp() {
        db = TestSupport.inMemoryDb()
        profiles = ProfileRepository(db, active, clock, ids)
        answers = AnswerRepository(db, clock, ids)
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun `creating an adult profile makes it active, with audience and language from its kind`() =
        runTest {
            val p = profiles.create(label = "Umar", kind = ProfileKind.ADULT, lang = Lang.EN)
            assertEquals(p.id, active.activeId.first())
            assertEquals(id.petalytix.ayailmu.core.model.Audience.ADULTS, p.audience)
            assertEquals(Lang.EN, profiles.observeActive().first()?.lang)
        }

    @Test
    fun `an Anak profile can only be created from an existing adult (CR-DAT-5)`() =
        runTest {
            assertFailsWith<IllegalArgumentException> { profiles.create("Kid", ProfileKind.ANAK, Lang.ID) }
            val adult = profiles.create("Parent", ProfileKind.ADULT, Lang.ID)
            val kid = profiles.create("Kid", ProfileKind.ANAK, Lang.ID, birthYear = 2017, createdBy = adult.id, makeActive = false)
            assertEquals(id.petalytix.ayailmu.core.model.Audience.KIDS, kid.audience)
            assertEquals(adult.id, active.activeId.first()) // not switched
            assertFailsWith<IllegalArgumentException> { profiles.create("Kid2", ProfileKind.ANAK, Lang.ID, createdBy = kid.id) }
        }

    @Test
    fun `language change is stored on the profile`() =
        runTest {
            val p = profiles.create("Umar", ProfileKind.ADULT, Lang.ID)
            profiles.setLanguage(p.id, Lang.EN)
            assertEquals(Lang.EN, profiles.activeProfile()?.lang)
        }

    @Test
    fun `a session played through the controller is persisted, resumable and never repeats items`() =
        runTest {
            val content = ContentRepository(TestSupport.classpathAssets, AppBuildInfo(developerDemo = true, appVersion = "0.2.0"))
            val arab = assertNotNull(content.track("arab"))
            val p = profiles.create("Umar", ProfileKind.ADULT, Lang.ID)

            fun start(history: List<id.petalytix.ayailmu.core.model.AnswerEvent>): SessionState =
                Session.start(
                    StartArgs(
                        content = arab.content, rules = arab.rules, history = history, learnerId = p.id, lang = p.lang,
                        audience = p.audience, nowEpochMs = clock.now().toEpochMilli(), zone = TestSupport.ZONE,
                        budgetMinutes = 15, screensSeen = listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"), appVersion = "0.2.0",
                        random = Random(1), ids = ids,
                    ),
                )

            val c =
                SessionController(
                    store = answers.storeFor(p.id), content = arab.content, rules = arab.rules, initialState = start(emptyList()),
                    history = emptyList(), screensSeen = p.screensSeen, clock = clock, ids = ids,
                )
            assertEquals(SaveResult.SAVED, c.submit(Response.typed("jujur"), 1200))
            assertEquals(SaveResult.SAVED, c.next())

            // Event stored with its full payload, and the snapshot resumes at the next item.
            val stored = answers.history(p.id, "arab")
            assertEquals(listOf("DEMO-M01"), stored.map { it.itemId })
            assertEquals(Outcome.CORRECT, stored.single().outcome)
            val resumed = assertNotNull(answers.resumable(p.id, arab.content))
            assertEquals(Step.item("DEMO-F01", Step.Role.PRACTICE), resumed.currentStep)

            // A new session the same day, built from stored history, does not serve DEMO-M01 again.
            val next = start(stored)
            assertTrue(next.queue.none { it.id == "DEMO-M01" })
        }

    @Test
    fun `re-recording the same answer id is ignored (idempotent writes)`() =
        runTest {
            val p = profiles.create("Umar", ProfileKind.ADULT, Lang.ID)
            val content = ContentRepository(TestSupport.classpathAssets, AppBuildInfo(true, "0.2.0"))
            val arab = assertNotNull(content.track("arab"))
            val state =
                Session.start(
                    StartArgs(arab.content, arab.rules, emptyList(), p.id, Lang.ID, null, clock.now().toEpochMilli(), TestSupport.ZONE, 15, listOf("DEMO-S1", "DEMO-S2", "DEMO-S3"), "0.2.0", Random(1), ids),
                )
            val r = Session.submit(state, Response.typed("jujur"), id.petalytix.ayailmu.core.engine.Env(arab.content, arab.rules, emptyList(), clock.now().toEpochMilli(), 1, ids = ids))
            val store = answers.storeFor(p.id)
            store.recordAnswer(r.event!!, r.state)
            store.recordAnswer(r.event!!, r.state)
            assertEquals(1, answers.history(p.id, "arab").size)
        }

    @Test
    fun `deleting a profile removes its answers, snapshots and reports, and moves active to another profile`() =
        runTest {
            val a = profiles.create("A", ProfileKind.ADULT, Lang.ID)
            val b = profiles.create("B", ProfileKind.ADULT, Lang.EN)
            answers.addReport(b.id, "DEMO-M01", "demo-synthetic-0.1", "typo", "harakat looks off")
            profiles.delete(b.id)
            assertEquals(a.id, active.activeId.first())
            assertTrue(answers.allReports().isEmpty())
            assertEquals(listOf(a.id), profiles.all().map { it.id })
        }

    @Test
    fun `delete-all clears every table, the active profile and the reminder`() =
        runTest {
            profiles.create("A", ProfileKind.ADULT, Lang.ID)
            val reminders = InMemoryReminderStore(ReminderSetting(enabled = true, hour = 7, minute = 30))
            var filesCleared = false
            DataResetter(db, active, reminders) { filesCleared = true }.deleteAll()
            assertTrue(profiles.all().isEmpty())
            assertTrue(answers.allEvents().isEmpty())
            assertNull(active.activeId.first())
            assertEquals(ReminderSetting(), reminders.reminder.first())
            assertTrue(filesCleared)
        }

    @Test
    fun `session length, Arabic size and consent are stored on the profile`() =
        runTest {
            val a = profiles.create("A", ProfileKind.ADULT, Lang.ID)
            profiles.setSessionMinutes(a.id, 15)
            profiles.setArabicScale(a.id, 5f) // clamped (CR-ENG-6)
            profiles.recordConsent(a.id, "arab-trial-1")
            val stored = assertNotNull(profiles.activeProfile())
            assertEquals(15, stored.sessionMinutes)
            assertEquals(ARABIC_SCALE_MAX, stored.arabicScale)
            assertEquals("arab-trial-1", stored.consentVersion)

            profiles.setSessionMinutes(a.id, null)
            profiles.withdrawConsent(a.id)
            val after = assertNotNull(profiles.activeProfile())
            assertNull(after.sessionMinutes)
            assertNull(after.consentVersion)
        }
}
