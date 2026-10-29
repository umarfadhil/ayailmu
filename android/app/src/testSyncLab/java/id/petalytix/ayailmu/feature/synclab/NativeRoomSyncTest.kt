package id.petalytix.ayailmu.feature.synclab

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.content.*
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.db.*
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.*
import id.petalytix.ayailmu.core.model.*
import id.petalytix.ayailmu.core.sync.*
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import net.openid.appauth.CodeVerifierUtil

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class NativeRoomSyncTest {
    @Test fun googlePreparationUsesAppAuthPkceAndStaysDisabledWithoutSetup() {
        val verifier = CodeVerifierUtil.generateRandomCodeVerifier()
        CodeVerifierUtil.checkCodeVerifier(verifier)
        assertEquals("S256", CodeVerifierUtil.getCodeVerifierChallengeMethod())
        val challenge = CodeVerifierUtil.deriveCodeVerifierChallenge(verifier)
        val url = GoTrueAuth("http://127.0.0.1:8287").googleUrl(challenge, "id.petalytix.ayailmu.synclab://auth-callback/nonce1")
        assertTrue(url.contains("provider=google"))
        assertTrue(url.contains("code_challenge_method=s256"))
        assertTrue(url.contains("redirect_to="))
        assertFalse(url.contains("client_secret"))
        assertFalse(url.contains("gmail"))
    }
    private val assets = AssetSource { path -> requireNotNull(requireNotNull(javaClass.classLoader).getResourceAsStream(path)).use { it.readBytes().decodeToString() } }
    private val clock = SystemClock()
    private fun db(context: Context) = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
    private fun answer(learner: String, history: List<AnswerEvent> = emptyList()): Pair<AnswerEvent, SessionState> {
        val pack = PackLoader.parse(assets.read("packs/bahasa/arab/v1.json")); val content = Gating.gate(pack, true)
        val rules = RuleConfig.parse(assets.read("config/rules.arab.json")); val now = Instant.parse("2026-10-19T01:00:00Z").toEpochMilli()
        var state = Session.start(StartArgs(content, rules, history, learner, Lang.ID, Audience.ADULTS, now, ZoneId.of("UTC"), 15, emptyList(), "0.1.0-synclab", Random(1)))
        while (state.currentStep?.kind == Step.Kind.SCREEN) state = Session.advance(state, now)
        val item = content.item(state.currentStep!!.id)
        val response = if (item.type == ItemType.TYPE_IN) Response.typed("jujur") else Response.dontKnow()
        val result = Session.submit(state, response, Env(content, rules, history, now, 1000))
        return assertNotNull(result.event) to result.state
    }
    @Test fun roomPayloadObservationPreservesOriginalNativeTransaction() = runBlocking {
        val database = db(ApplicationProvider.getApplicationContext())
        try {
            val (event, snapshot) = answer("syn_warmup")
            RoomSessionStore(database, "syn_warmup", clock).recordAnswer(event, snapshot)
            val raw = database.answers().observePayloads("syn_warmup").first().single()
            assertEquals(ContentJson.json.encodeToString(AnswerEvent.serializer(), event), raw)
            assertEquals(event, Mappers.event(database.answers().history("syn_warmup", "arab").single()))
            assertNotNull(database.snapshots().get("syn_warmup", "arab"))
            assertTrue(database.answers().payloads("syn_other").isEmpty())
        } finally { database.close() }
    }
    private class NetworkGate(private val real: Backend) : Backend by real {
        var offline = false
        var loseReceipt = false
        override suspend fun catalog(token: String): Catalog { if (offline) throw IOException("Synthetic offline"); return real.catalog(token) }
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> {
            if (offline) throw IOException("Synthetic offline")
            val receipt = real.append(token, learnerId, payloads)
            if (loseReceipt) { loseReceipt = false; throw IOException("Synthetic post-commit disconnect") }
            return receipt
        }
    }
    @Test fun realRoomRepositoryOfflineSecondClientAndLogoutIsolation() = runBlocking {
        val fixture = System.getenv("UMAR_E2E_FIXTURES")
        assumeTrue("Run integration/run-android-e2e.sh for real local services", !fixture.isNullOrBlank())
        val tokens = Json.parseToJsonElement(File(fixture!!).readText()).jsonObject
        val tokenA = tokens.getValue("A").jsonPrimitive.content; val tokenB = tokens.getValue("B").jsonPrimitive.content
        val base: Context = ApplicationProvider.getApplicationContext()
        val dir = Files.createTempDirectory("umar-native-room-e2e").toFile()
        fun context(name: String) = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = File(dir, name).apply { mkdirs() } }
        val dbA = db(base); val dbB = db(base)
        val activeA = InMemoryActiveProfileStore(); val activeB = InMemoryActiveProfileStore()
        val api = HttpBackend(tokens["api"]?.jsonPrimitive?.content ?: "http://127.0.0.1:8186"); val network = NetworkGate(api)
        val first = SyncLabRepository(context("client-a"), dbA, activeA, assets, ContentRepository(assets, AppBuildInfo(true, "test")), clock, network)
        val second = SyncLabRepository(context("client-b"), dbB, activeB, assets, ContentRepository(assets, AppBuildInfo(true, "test")), clock, api)
        try {
            first.login(tokenA); first.create(); val learner = assertNotNull(first.state.value.selected)
            assertEquals(learner.clientLearnerId, activeA.activeId.first())
            assertEquals(1980, dbA.profiles().get(learner.clientLearnerId)!!.birthYear)
            first.enable(); network.offline = true
            val (event, snapshot) = answer(learner.clientLearnerId)
            RoomSessionStore(dbA, learner.clientLearnerId, clock).recordAnswer(event, snapshot)
            withTimeout(10_000) { first.state.first { it.pending == 1 } }
            first.sync(); assertEquals(1, first.state.value.pending)
            assertEquals(event, Mappers.event(dbA.answers().history(learner.clientLearnerId, "arab").single()))
            network.offline = false; network.loseReceipt = true
            first.sync(); assertEquals(1, first.state.value.pending)
            first.sync(); assertEquals(0, first.state.value.pending); assertEquals(1, first.state.value.remoteAnswers)
            val raw = dbA.answers().payloads(learner.clientLearnerId).single()
            assertEquals(raw, api.pull(tokenA, learner.id, 0).events.single().payload)
            second.login(tokenA); second.select(learner); second.enable(); second.sync()
            assertEquals(1, second.state.value.remoteAnswers)
            assertEquals(first.state.value.learnedSkills, second.state.value.learnedSkills)
            assertTrue(dbB.answers().payloads(learner.clientLearnerId).isEmpty(), "Remote history must not silently alter native local mastery")
            second.disable()
            val (later, laterSnapshot) = answer(learner.clientLearnerId, listOf(event))
            RoomSessionStore(dbA, learner.clientLearnerId, clock).recordAnswer(later, laterSnapshot)
            withTimeout(10_000) { first.state.first { it.pending == 1 } }
            first.sync(); assertFalse(first.state.value.enabled); assertEquals(0, first.state.value.remoteAnswers)
            first.logout(); assertNull(first.state.value.owner); assertNull(activeA.activeId.first())
            first.login(tokenB); assertNull(first.state.value.selected); assertTrue(first.state.value.learners.none { it.id == learner.id })
            assertFailsWith<IllegalArgumentException> { first.select(learner) }
            first.create(); assertNotEquals(learner.id, first.state.value.selected!!.id)
            assertEquals(2, dbA.answers().payloads(learner.clientLearnerId).size, "Original local native history stays intact")
            println("REAL_ANDROID_ROOM_E2E_PASS: native RoomSessionStore -> exact payload observer -> durable opt-in outbox -> real API; offline and committed retry; second repository progress; local mastery unchanged; revoke; logout/account isolation")
        } finally { first.stop(); second.stop(); delay(100); dbA.close(); dbB.close(); dir.deleteRecursively() }
    }
}
