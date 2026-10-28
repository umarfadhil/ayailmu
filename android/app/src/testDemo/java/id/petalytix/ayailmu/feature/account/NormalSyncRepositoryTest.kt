package id.petalytix.ayailmu.feature.account

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.db.ProfileEntity
import id.petalytix.ayailmu.core.data.db.toEntity
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentCatalog
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.engine.UuidIdGenerator
import id.petalytix.ayailmu.core.model.*
import id.petalytix.ayailmu.core.sync.*
import java.io.File
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private val testConfig = NormalAccountConfig.forValues(true, "https://accounts.petalytix.id", "owner-policy-1")
private fun testAssets(): AssetSource {
    val base = AssetSource { path -> requireNotNull(NormalSyncRepositoryTest::class.java.classLoader!!.getResourceAsStream(path)).use { it.readBytes().decodeToString() } }
    val original = ContentJson.json.decodeFromString(ContentCatalog.serializer(), base.read(ContentRepository.CATALOG))
    val fixtureCatalog = ContentJson.json.encodeToString(ContentCatalog.serializer(), original.copy(tracks = original.tracks.take(1)))
    return AssetSource { path ->
        when (path) {
            ContentRepository.CATALOG -> fixtureCatalog
            "packs/bahasa/arab/v1.json" -> base.read(path).replace("\"review_status\": \"draft\"", "\"review_status\": \"approved\"").replace("\"review_status\":\"draft\"", "\"review_status\":\"approved\"")
            else -> base.read(path)
        }
    }
}

/** The real packaged catalog's first track with every item left in its shipped (non-approved) state. */
private fun unapprovedAssets(): AssetSource {
    val base = AssetSource { path -> requireNotNull(NormalSyncRepositoryTest::class.java.classLoader!!.getResourceAsStream(path)).use { it.readBytes().decodeToString() } }
    val original = ContentJson.json.decodeFromString(ContentCatalog.serializer(), base.read(ContentRepository.CATALOG))
    val fixtureCatalog = ContentJson.json.encodeToString(ContentCatalog.serializer(), original.copy(tracks = original.tracks.take(1)))
    return AssetSource { path -> if (path == ContentRepository.CATALOG) fixtureCatalog else base.read(path) }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NormalSyncRepositoryTest {
    private val config = testConfig
    private val declaration = NormalOwnerDeclaration("adult-owner-v1", true)
    private class FakeBackend : Backend {
        lateinit var catalogValue: Catalog
        val profiles = mutableMapOf<String, MutableList<Learner>>()
        val uploaded = mutableListOf<String>()
        val remote = mutableMapOf<String, LinkedHashMap<String, String>>()
        var offline = false
        /** Test-only: the registry becomes unreachable once any learner has been created. */
        var catalogOfflineAfterCreate = false
        /** Test-only: the create reply is delivered, then all connectivity is lost. */
        var offlineAfterCreate = false
        var creates = 0
        var catalogGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        val catalogEntered = kotlinx.coroutines.CompletableDeferred<Unit>()
        var createGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        val createEntered = kotlinx.coroutines.CompletableDeferred<Unit>()
        override suspend fun account(token: String) = "owner-$token"
        override suspend fun currentAccount(token: String) = "owner-$token"
        override suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean): String {
            check(adultConfirmed && declarationVersion == "adult-owner-v1"); network(); onActivated?.invoke(token); return "owner-$token"
        }
        /** Test-only: only the learner-list endpoint is unreachable; login, catalog and create still work. */
        var learnersFail = false
        /** Test-only: runs when an owner activation succeeds, before its reply is returned. */
        var onActivated: ((String) -> Unit)? = null
        /** Test-only one-shot gate: the next learners() call, once armed, suspends here until released. */
        var learnersGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        val learnersEntered = kotlinx.coroutines.CompletableDeferred<Unit>()
        override suspend fun learners(token: String): List<Learner> {
            network()
            if (learnersFail) throw IOException("synthetic learner list offline")
            val gate = learnersGate
            if (gate != null) { learnersGate = null; learnersEntered.complete(Unit); gate.await() }
            return profiles[token].orEmpty()
        }
        override suspend fun createLearner(token: String, clientId: String) = error("synthetic entry forbidden")
        override suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String): Learner {
            network(); createEntered.complete(Unit); createGate?.await(); creates++
            return Learner("remote-$clientId", clientId, kind, "adults", lang).also {
                profiles.getOrPut(token) { mutableListOf() }.add(it)
                if (offlineAfterCreate) offline = true
            }
        }
        override suspend fun catalog(token: String): Catalog {
            catalogEntered.complete(Unit); catalogGate?.await()
            if (catalogOfflineAfterCreate && creates > 0) throw IOException("synthetic registry offline")
            return catalogValue
        }
        override suspend fun consent(token: String, learnerId: String, granted: Boolean) = network()
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> {
            network(); val stored = remote.getOrPut(learnerId) { linkedMapOf() }
            return payloads.map { raw ->
                val id = Json.parseToJsonElement(raw).jsonObject.getValue("answer_id").jsonPrimitive.content
                check(stored[id] == null || stored[id] == raw); stored[id] = raw; uploaded += raw
                Receipt(id, stored.keys.indexOf(id) + 1L, false, "registered")
            }
        }
        override suspend fun pull(token: String, learnerId: String, after: Long): Page {
            network(); val records = remote[learnerId].orEmpty().values.mapIndexed { i, raw -> RemoteRecord(i + 1L, raw, "registered") }.filter { it.sequence > after }
            return Page(records, records.lastOrNull()?.sequence ?: after, false)
        }
        private fun network() { if (offline) throw IOException("synthetic offline") }
    }
    /** Test-only active-profile store whose next read can be suspended, to hold a login continuation mid-flight. */
    private class GatedActiveStore(private val inner: InMemoryActiveProfileStore = InMemoryActiveProfileStore()) : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
        @Volatile var gate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        val entered = kotlinx.coroutines.CompletableDeferred<Unit>()
        override val activeId = kotlinx.coroutines.flow.flow<String?> {
            val g = gate
            if (g != null) { gate = null; entered.complete(Unit); g.await() }
            inner.activeId.collect { emit(it) }
        }
        override suspend fun setActive(id: String?) = inner.setActive(id)
    }
    private class Harness(val dir: File, val api: FakeBackend, val db: AyaDatabase, val active: id.petalytix.ayailmu.core.data.settings.ActiveProfileStore, val assets: AssetSource = testAssets()) {
        val visibility: NormalProfileVisibility
        val repository: NormalSyncRepository
        val profiles: ProfileRepository
        init {
            val base = ApplicationProvider.getApplicationContext<Context>()
            val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
            visibility = NormalProfileVisibility(context, testConfig, db)
            val content = ContentRepository(assets, AppBuildInfo(true, "test"))
            repository = NormalSyncRepository(context, db, active, assets, content, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), api, testConfig, visibility)
            profiles = ProfileRepository(db, active, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), UuidIdGenerator, visibility)
        }
        suspend fun stop() = repository.stop()
    }
    private suspend fun Harness.prepare(apiCatalog: suspend (FakeBackend) -> Unit) { apiCatalog(api) }
    private suspend fun catalog(content: ContentRepository, assetSource: AssetSource): Catalog {
        val entries = ContentJson.json.decodeFromString(ContentCatalog.serializer(), assetSource.read(ContentRepository.CATALOG))
        val packs = content.tracks().map { loaded ->
            val entry = entries.tracks.single { it.track == loaded.track }
            val proof = PackProof.fromBytes(assetSource.read(entry.pack).encodeToByteArray(), assetSource.read(entry.rules).encodeToByteArray(), testConfig.registrySourceCommit)
            CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)
        }
        return Catalog(testConfig.registrySourceCommit, packs)
    }
    private suspend fun event(h: Harness, answerId: String, learner: Learner): AnswerEvent {
        val loaded = h.repository.let {
            val assets = testAssets(); ContentRepository(assets, AppBuildInfo(true, "test"))
        }.track("arab")!!
        val item = loaded.pack.items.first { it.reviewStatus == ReviewStatus.APPROVED && it.type == ItemType.CHOOSE }
        return AnswerEvent(answerId, learner.clientLearnerId, item.itemId, "arab", loaded.pack.meta.contentVersion, loaded.rules.rulesVersion,
            "test", "2026-10-26T01:00:00Z", "2026-10-26", "session-$answerId", Lang.ID, item.pool, item.unit, item.skills,
            "{\"kind\":\"choice\",\"option_id\":\"a\"}", emptyMap(), Outcome.CORRECT, firstAttempt = true, freshEvidence = false,
            reviewStatus = ReviewStatus.APPROVED, synthetic = false, itemType = item.type)
    }
    private suspend fun newHarness(dir: File, api: FakeBackend, db: AyaDatabase, active: id.petalytix.ayailmu.core.data.settings.ActiveProfileStore, assets: AssetSource = testAssets()): Harness {
        if (!::catalogCache.isInitialized) catalogCache = catalog(ContentRepository(testAssets(), AppBuildInfo(true, "test")), testAssets())
        api.catalogValue = catalogCache
        return Harness(dir, api, db, active, assets).also { it.visibility.refresh() }
    }
    private lateinit var catalogCache: Catalog

    @Test fun createWithNoApprovedContentDoesNotMutateRemoteOrRoomAndRetryCannotDuplicate() = runTest {
        val dir = File.createTempFile("normal-no-content", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active, unapprovedAssets())
        try {
            h.repository.login("A", declaration)
            repeat(2) {
                val failure = runCatching { h.repository.createAdult("Owner", "id") }.exceptionOrNull()
                assertNotNull("Creating a learner without approved content must fail", failure)
                h.repository.failed(failure as Exception)
                assertEquals(NormalSyncNotice.NO_APPROVED_CONTENT, h.repository.state.value.notice)
                assertFalse(h.repository.state.value.busy)
            }
            assertEquals("No remote learner may be created before content is known to be syncable", 0, api.creates)
            assertTrue(api.profiles.values.flatten().isEmpty())
            assertTrue(h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun createWithRegistryProofMismatchFailsBeforeRemoteMutationWithAnActionableNotice() = runTest {
        val dir = File.createTempFile("normal-registry-mismatch", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.catalogValue = api.catalogValue.copy(packs = api.catalogValue.packs.map { it.copy(packSha256 = "0".repeat(64)) })
            val failure = runCatching { h.repository.createAdult("Owner", "id") }.exceptionOrNull()
            assertNotNull("An incompatible registry must reject creation", failure)
            h.repository.failed(failure as Exception)
            assertEquals(NormalSyncNotice.CONTENT_MISMATCH, h.repository.state.value.notice)
            assertEquals(0, api.creates)
            assertTrue(h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)
            assertTrue(db.profiles().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun createdLearnerStaysVisibleAndSelectableWhenBindingFailsAfterRemoteCreate() = runTest {
        val dir = File.createTempFile("normal-create-partial", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.catalogOfflineAfterCreate = true
            val failure = runCatching { h.repository.createAdult("Owner", "id") }.exceptionOrNull()
            assertTrue("Binding must surface the interrupted registry check", failure is IOException)
            assertEquals(1, api.creates)
            val created = h.repository.state.value.learners.single()
            assertNull(h.repository.state.value.selected)
            assertNull(active.activeId.first())
            assertFalse(h.repository.state.value.busy)
            api.catalogOfflineAfterCreate = false
            h.repository.select(created, "Owner")
            assertEquals(created, h.repository.state.value.selected)
            assertEquals(created.clientLearnerId, active.activeId.first())
            assertEquals("Retry must bind the learner that already exists instead of creating another", 1, api.creates)
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun returnedLearnerStaysVisibleWhenAllConnectivityIsLostAfterCreateAndReconnectSelectsItWithoutASecondCreate() = runTest {
        val dir = File.createTempFile("normal-create-disconnect", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.offlineAfterCreate = true
            val failure = runCatching { h.repository.createAdult("Owner", "id") }.exceptionOrNull()
            assertTrue("Bind and refresh both need the network, so the action must fail", failure is IOException)
            assertTrue(api.offline)
            assertEquals(1, api.creates)
            val created = h.repository.state.value.learners.single()
            assertEquals(api.profiles.getValue("A").single(), created)
            assertEquals("owner-A", h.repository.state.value.owner)
            assertNull("A failed bind must not select the learner", h.repository.state.value.selected)
            assertFalse("A failed bind must not enable consent", h.repository.state.value.enabled)
            assertFalse(h.repository.state.value.busy)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())

            api.offline = false; api.offlineAfterCreate = false
            h.repository.select(created, "Owner")
            assertEquals(created, h.repository.state.value.selected)
            assertEquals(created.clientLearnerId, active.activeId.first())
            assertEquals("owner-A", db.ownerBindings().all().single().ownerId)
            assertFalse("Selecting must not grant sync consent", h.repository.state.value.enabled)
            assertTrue(api.remote.isEmpty())
            assertEquals("Exactly one remote create across failure, reconnect and select", 1, api.creates)
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun accountActionStaysBusyUntilPostCreateBindingFinishes() = runTest {
        val dir = File.createTempFile("normal-create-busy", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>(); api.learnersGate = gate
            val creating = async { runCatching { h.repository.createAdult("Owner", "id") } }
            api.learnersEntered.await()
            assertEquals("The remote learner exists while binding is still in flight", 1, api.creates)
            assertTrue("The action must stay busy until binding finishes", h.repository.state.value.busy)
            assertNull(h.repository.state.value.selected)
            gate.complete(Unit)
            assertTrue(creating.await().isSuccess)
            assertFalse(h.repository.state.value.busy)
            assertEquals(api.profiles.getValue("A").single(), h.repository.state.value.selected)
            assertEquals(1, api.creates)
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun ownerChangeDuringPostCreateBindingNeverShowsTheCreatedLearnerToTheNewOwner() = runTest {
        val dir = File.createTempFile("normal-create-owner-change", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>(); api.learnersGate = gate
            val creating = async { runCatching { h.repository.createAdult("Owner", "id") } }
            api.learnersEntered.await()
            h.repository.logout()
            h.repository.login("B", declaration)
            gate.complete(Unit)
            assertTrue("A's action must not complete under owner B", creating.await().isFailure)
            assertEquals(1, api.creates)
            assertEquals("owner-B", h.repository.state.value.owner)
            assertTrue("A's learner must never be shown to B", h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)
            assertFalse(h.repository.state.value.enabled)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun staleLoginListFetchedUnderAnotherOwnerIsNeverCachedForTheEarlierOwner() = runTest {
        val dir = File.createTempFile("normal-login-stale-list", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = GatedActiveStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            val learnerA = Learner("remote-lrn_a", "lrn_a", "ADULT", "adults", "id")
            val learnerB = Learner("remote-lrn_b", "lrn_b", "ADULT", "adults", "id")
            api.profiles["A"] = mutableListOf(learnerA); api.profiles["B"] = mutableListOf(learnerB)
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
            // A's login commits, passes finishLogin's owner check, then parks while reading the active profile.
            api.onActivated = { token -> if (token == "A") active.gate = gate }
            val loginA = async { runCatching { h.repository.login("A", declaration) } }
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { kotlinx.coroutines.withTimeout(20_000) { active.entered.await() } }

            h.repository.login("B", declaration)
            assertEquals("owner-B", h.repository.state.value.owner)
            assertEquals(listOf(learnerB), h.repository.state.value.learners)

            gate.complete(Unit)
            assertTrue(loginA.await().isSuccess)
            assertEquals("A's late continuation must not touch owner B's visible state", "owner-B", h.repository.state.value.owner)
            assertEquals("A's late continuation must not replace owner B's learner list", listOf(learnerB), h.repository.state.value.learners)

            h.repository.logout()
            api.learnersFail = true
            h.repository.login("A", declaration)
            assertEquals("owner-A", h.repository.state.value.owner)
            assertEquals("A genuine list-fetch failure is still reported", NormalSyncNotice.OFFLINE, h.repository.state.value.notice)
            assertTrue("B's learner must never be exposed under owner A", h.repository.state.value.learners.none { it.clientLearnerId == learnerB.clientLearnerId })
            assertTrue("Offline, A sees only learners already bound on this device", h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun staleLoginListFailureAfterAnotherOwnerSignedInNeverOverwritesTheNewOwnersReadyState() = runTest {
        val dir = File.createTempFile("normal-login-stale-failure", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            val learnerA = Learner("remote-lrn_a", "lrn_a", "ADULT", "adults", "id")
            val learnerB = Learner("remote-lrn_b", "lrn_b", "ADULT", "adults", "id")
            api.profiles["A"] = mutableListOf(learnerA); api.profiles["B"] = mutableListOf(learnerB)
            // A's own learners request is the one that parks; the one-shot gate is consumed by it.
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>(); api.learnersGate = gate
            val loginA = async { runCatching { h.repository.login("A", declaration) } }
            api.learnersEntered.await()

            h.repository.login("B", declaration)
            assertEquals("owner-B", h.repository.state.value.owner)
            assertEquals(listOf(learnerB), h.repository.state.value.learners)
            assertEquals(NormalSyncNotice.READY, h.repository.state.value.notice)

            // Releasing A makes the engine reject its response ("Sign-in session changed").
            gate.complete(Unit)
            assertTrue("A's stale attempt ends quietly", loginA.await().isSuccess)
            assertEquals("owner-B", h.repository.state.value.owner)
            assertEquals(listOf(learnerB), h.repository.state.value.learners)
            assertEquals("A's stale failure must not publish OFFLINE over B's READY", NormalSyncNotice.READY, h.repository.state.value.notice)
            assertNull(h.repository.state.value.selected)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun staleLoginListFailureAfterSameOwnerRelogoutAndReloginKeepsTheNewSessionsReadyState() = runTest {
        val dir = File.createTempFile("normal-login-stale-failure-same-owner", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            val first = Learner("remote-lrn_first", "lrn_first", "ADULT", "adults", "id")
            val second = Learner("remote-lrn_second", "lrn_second", "ADULT", "adults", "id")
            api.profiles["A"] = mutableListOf(first)
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>(); api.learnersGate = gate
            val staleLogin = async { runCatching { h.repository.login("A", declaration) } }
            api.learnersEntered.await()

            // Same owner, new session generation; the list the new session sees differs from the parked request's.
            h.repository.logout()
            api.profiles["A"] = mutableListOf(second)
            h.repository.login("A", declaration)
            assertEquals("owner-A", h.repository.state.value.owner)
            assertEquals(listOf(second), h.repository.state.value.learners)
            assertEquals(NormalSyncNotice.READY, h.repository.state.value.notice)

            gate.complete(Unit)
            assertTrue("The earlier session's attempt ends quietly", staleLogin.await().isSuccess)
            assertEquals("owner-A", h.repository.state.value.owner)
            assertEquals(listOf(second), h.repository.state.value.learners)
            assertEquals("The earlier session's failure must not publish OFFLINE over the new READY", NormalSyncNotice.READY, h.repository.state.value.notice)
            assertNull(h.repository.state.value.selected)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun lateListAfterSelectionCannotReachAnotherOwnerOrALaterOfflineRestore() = runTest {
        val dir = File.createTempFile("normal-select-stale-list", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration); h.repository.createAdult("Owner", "id")
            val bound = h.repository.state.value.selected!!
            val extra = Learner("remote-lrn_extra", "lrn_extra", "ADULT", "adults", "id")
            api.profiles.getValue("A") += extra
            // Re-selecting the bound learner skips the ownership lookup, so the first list request is the post-select refresh.
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>(); api.learnersGate = gate
            val selecting = async { runCatching { h.repository.select(bound) } }
            api.learnersEntered.await()

            h.repository.logout()
            h.repository.login("B", declaration)
            gate.complete(Unit)
            assertTrue("A's selection must not report success after B signed in", selecting.await().isFailure)
            assertEquals("owner-B", h.repository.state.value.owner)
            assertTrue("A's learners must not appear for B", h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)

            h.repository.logout()
            api.learnersFail = true
            h.repository.login("A", declaration)
            assertEquals("owner-A", h.repository.state.value.owner)
            assertEquals(NormalSyncNotice.OFFLINE, h.repository.state.value.notice)
            assertEquals("Offline restore shows only what is bound locally, not the late server list",
                listOf(bound.clientLearnerId), h.repository.state.value.learners.map { it.clientLearnerId })
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    private suspend fun kotlinx.coroutines.CoroutineScope.assertPreflightInterruptionMutatesNothing(interrupt: suspend (Harness) -> Unit) {
        val dir = File.createTempFile("normal-preflight-interrupt", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.catalogGate = kotlinx.coroutines.CompletableDeferred()
            val creating = async { runCatching { h.repository.createAdult("Owner", "id") } }
            api.catalogEntered.await()
            interrupt(h)
            api.catalogGate!!.complete(Unit)
            assertTrue("An interrupted preflight must fail the action", creating.await().isFailure)
            assertEquals("No remote create after cancellation or session change", 0, api.creates)
            assertTrue(api.profiles.values.flatten().isEmpty())
            assertTrue(api.remote.isEmpty())
            assertTrue(h.repository.state.value.learners.isEmpty())
            assertNull(h.repository.state.value.selected)
            assertFalse(h.repository.state.value.enabled)
            assertNull(active.activeId.first())
            assertTrue(db.profiles().all().isEmpty())
            assertTrue(db.ownerBindings().all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun cancellationWhilePreflightIsSuspendedCreatesNothingRemoteOrLocal() = runTest {
        assertPreflightInterruptionMutatesNothing { it.repository.cancelActions() }
    }

    @Test fun signOutWhilePreflightIsSuspendedCreatesNothingRemoteOrLocal() = runTest {
        assertPreflightInterruptionMutatesNothing { it.repository.logout() }
    }

    @Test fun stopWaitsForStartupCancellationBeforeRoomCanBeClosed() = runTest {
        val dir = File.createTempFile("normal-stop", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val entered = kotlinx.coroutines.CompletableDeferred<Unit>()
        val cancelling = kotlinx.coroutines.CompletableDeferred<Unit>()
        val release = kotlinx.coroutines.CompletableDeferred<Unit>()
        var cleanupFinished = false
        val active = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
            override val activeId = kotlinx.coroutines.flow.flow<String?> {
                entered.complete(Unit)
                try { kotlinx.coroutines.awaitCancellation() } finally {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
                        cancelling.complete(Unit)
                        release.await()
                        // An in-flight dependency operation must finish before Room closes.
                        db.profiles().all()
                        cleanupFinished = true
                    }
                }
            }
            override suspend fun setActive(id: String?) = Unit
        }
        val visibility = NormalProfileVisibility(context, config, db)
        val assets = testAssets()
        val repository = NormalSyncRepository(context, db, active, assets, ContentRepository(assets, AppBuildInfo(true, "test")),
            FixedClock(Instant.EPOCH), FakeBackend(), config, visibility)
        try {
            entered.await()
            val stopping = async { repository.stop() }
            runCurrent()
            cancelling.await()
            assertFalse("Stop must await in-flight startup cleanup", stopping.isCompleted)
            release.complete(Unit)
            stopping.await()
            assertTrue(cleanupFinished)
            repository.stop()
        } finally {
            release.complete(Unit)
            repository.stop()
            db.close()
            dir.deleteRecursively()
        }
    }

    @Test fun ownerChangeAndFreshProcessHideBoundNativeProfilesButKeepUnboundHistory() = runTest {
        val dir = File.createTempFile("normal-room", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore("device-local")
        db.profiles().upsert(ProfileEntity("device-local", "Offline", "ADULT", null, null, "ADULTS", "id", 1, null, 1f, "[]", null, null))
        val api = FakeBackend(); val a = newHarness(dir, api, db, active)
        try {
            a.repository.login("A", declaration)
            a.repository.createAdult("A owner", "id")
            val bound = a.repository.state.value.selected!!
            assertEquals(bound.clientLearnerId, active.activeId.first())
            assertTrue(a.profiles.all().any { it.id == bound.clientLearnerId })
            a.repository.logout()
            assertEquals("device-local", active.activeId.first())
            assertFalse(a.profiles.all().any { it.id == bound.clientLearnerId })
            val b = newHarness(dir, api, db, active)
            b.repository.login("B", declaration)
            assertEquals(setOf("device-local"), b.profiles.all().map { it.id }.toSet())
            val fresh = newHarness(dir, api, db, active)
            assertEquals(setOf("device-local"), fresh.profiles.all().map { it.id }.toSet())
            assertNotNull("Old native history must be retained", db.profiles().get(bound.clientLearnerId))
            b.stop(); fresh.stop()
        } finally { a.stop(); db.close(); dir.deleteRecursively() }
    }


    @Test fun routeCancellationDuringCreateCannotBindOrActivateLearner() = runTest {
        val dir = File.createTempFile("normal-cancel", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.createGate = kotlinx.coroutines.CompletableDeferred()
            val creating = async { runCatching { h.repository.createAdult("Late owner", "id") } }
            api.createEntered.await()
            h.repository.cancelActions()
            api.createGate!!.complete(Unit)
            assertTrue(creating.await().isFailure)
            assertNull(h.repository.state.value.selected)
            assertNull(active.activeId.first())
            assertTrue(h.profiles.all().isEmpty())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }


    @Test fun sameVerifiedOwnerCanRestoreRoomLearnerWithoutJournalButForeignOwnerCannot() = runTest {
        val dir = File.createTempFile("normal-restore", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val first = newHarness(dir, api, db, active)
        try {
            first.repository.login("A", declaration); first.repository.createAdult("Backed up owner", "id")
            val learner = first.repository.state.value.selected!!
            File(dir, "normal-owner-sync").deleteRecursively()
            val foreign = newHarness(dir, api, db, active)
            foreign.repository.login("B", declaration)
            assertThrows(IllegalStateException::class.java) { kotlinx.coroutines.runBlocking { foreign.repository.select(learner) } }
            assertEquals("owner-A", db.ownerBindings().all().single().ownerId)
            foreign.stop()
            val restored = newHarness(dir, api, db, active)
            restored.repository.login("A", declaration)
            restored.repository.select(learner)
            assertEquals(learner.clientLearnerId, active.activeId.first())
            assertEquals("Backed up owner", restored.repository.state.value.learnerLabels[learner.clientLearnerId])
            restored.stop()
        } finally { first.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun busyAndQueuedActionsAreFencedBeforeLateReplies() = runTest {
        val dir = File.createTempFile("normal-busy", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration)
            api.createGate = kotlinx.coroutines.CompletableDeferred()
            val first = async { runCatching { h.repository.createAdult("First", "id") } }
            api.createEntered.await()
            assertTrue(h.repository.state.value.busy)
            val queued = async { runCatching { h.repository.createAdult("Queued", "id") } }
            runCurrent()
            h.repository.cancelActions()
            api.createGate!!.complete(Unit)
            assertTrue(first.await().isFailure)
            queued.await()
            assertNull(h.repository.state.value.selected)
            assertFalse(h.repository.state.value.busy)
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }


    @Test fun deviceAndProfileCleanupClearRetainedEngineAndPreventFreshRestore() = runTest {
        val dir = File.createTempFile("normal-cleanup", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration); h.repository.createAdult("Owner", "id"); h.repository.enable()
            val learner = h.repository.state.value.selected!!
            db.answers().insert(event(h, "local-history", learner).toEntity(learner.clientLearnerId))
            h.repository.sync()
            assertEquals(0, h.repository.state.value.pending)
            h.repository.deleteProfile(learner.clientLearnerId)
            assertNull(h.repository.state.value.selected)
            assertEquals(0, h.repository.state.value.pending)
            val afterProfile = newHarness(dir, api, db, active)
            assertNull(afterProfile.repository.state.value.selected)
            afterProfile.stop()
            h.repository.deleteDevice()
            assertNull(h.repository.state.value.owner)
            val afterReset = newHarness(dir, api, db, active)
            assertNull(afterReset.repository.state.value.owner)
            assertNull(afterReset.repository.state.value.selected)
            assertEquals(0, afterReset.repository.state.value.restoredAnswers)
            afterReset.stop()
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun explicitOptInUploadsOnlyNewNativeAnswersAndOfflineRetryRestoresDedupe() = runTest {
        val dir = File.createTempFile("normal-sync", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            h.repository.login("A", declaration); h.repository.createAdult("Owner", "id")
            val learner = h.repository.state.value.selected!!
            db.answers().insert(event(h, "before-opt-in", learner).toEntity(learner.clientLearnerId))
            h.repository.enable()
            api.offline = true
            db.answers().insert(event(h, "after-opt-in", learner).toEntity(learner.clientLearnerId))
            h.repository.sync()
            assertEquals(1, h.repository.state.value.pending)
            assertTrue(api.uploaded.isEmpty())
            api.offline = false
            val restored = newHarness(dir, api, db, active)
            restored.repository.resume("A")
            restored.repository.sync()
            assertEquals(0, restored.repository.state.value.pending)
            assertEquals(listOf("after-opt-in"), api.uploaded.map { Json.parseToJsonElement(it).jsonObject.getValue("answer_id").jsonPrimitive.content })
            assertEquals("Restore must not duplicate local answers", 2, db.answers().payloads(learner.clientLearnerId).size)
            restored.stop()
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun secondDeviceRestoresUploadedProgressIntoRoomOnceAndResyncDoesNotDuplicate() = runTest {
        val dirA = File.createTempFile("normal-device-a", "").apply { delete() }
        val dirB = File.createTempFile("normal-device-b", "").apply { delete() }
        val context = ApplicationProvider.getApplicationContext<Context>()
        val dbA = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val dbB = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val api = FakeBackend(); val a = newHarness(dirA, api, dbA, InMemoryActiveProfileStore())
        val activeB = InMemoryActiveProfileStore()
        val b = newHarness(dirB, api, dbB, activeB)
        try {
            a.repository.login("A", declaration); a.repository.createAdult("Owner", "id"); a.repository.enable()
            val learner = a.repository.state.value.selected!!
            dbA.answers().insert(event(a, "device-a-answer", learner).toEntity(learner.clientLearnerId))
            a.repository.sync()
            assertEquals(0, a.repository.state.value.pending)
            assertEquals(1, api.remote.getValue(learner.id).size)

            b.repository.login("A", declaration)
            assertEquals("The second device must be offered the existing learner", listOf(learner), b.repository.state.value.learners)
            b.repository.select(learner, "Owner")
            assertEquals(learner.clientLearnerId, activeB.activeId.first())
            assertTrue("Selecting a learner must not invent history", dbB.answers().payloads(learner.clientLearnerId).isEmpty())
            b.repository.enable()
            b.repository.sync()
            assertEquals(1, b.repository.state.value.restoredAnswers)
            assertEquals(1, dbB.answers().payloads(learner.clientLearnerId).size)
            b.repository.sync()
            assertEquals(1, dbB.answers().payloads(learner.clientLearnerId).size)
            assertEquals("The restore must not fork the remote history", 1, api.remote.getValue(learner.id).size)
        } finally { a.stop(); b.stop(); dbA.close(); dbB.close(); dirA.deleteRecursively(); dirB.deleteRecursively() }
    }

    private class ViewModelGateway : NormalAuthGateway {
        var calls = 0
        var signInGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        val signInEntered = kotlinx.coroutines.CompletableDeferred<Unit>()
        private val user = AuthUser("owner-fixture", "owner@gmail.com", "2026-10-26T00:00:00Z")
        override suspend fun signUp(email: String, password: String) { calls++ }
        override suspend fun signIn(email: String, password: String): AuthSession {
            calls++; signInEntered.complete(Unit); signInGate?.await()
            return AuthSession("fixture-access", "fixture-refresh", 60, "bearer", user)
        }
        override suspend fun verifyOtp(email: String, code: String, type: String): AuthSession { calls++; return AuthSession("fixture-access", "fixture-refresh", 60, "bearer", user) }
        override suspend fun recover(email: String) { calls++ }
        override suspend fun resend(email: String) { calls++ }
        override suspend fun refresh(refreshToken: String): AuthSession { calls++; return AuthSession("fixture-access", "fixture-refresh", 60, "bearer", user) }
        override suspend fun user(token: String): AuthUser { calls++; return user }
        override suspend fun updatePassword(token: String, password: String): AuthUser { calls++; return user }
        override suspend fun signOut(token: String) { calls++ }
    }
    private class MemoryVault : NormalAuthVault {
        var value: SavedNormalAuth? = null
        override fun read() = value
        override fun write(value: SavedNormalAuth?) { this.value = value }
    }
    private fun viewModel(h: Harness, gateway: ViewModelGateway = ViewModelGateway(), vault: NormalAuthVault = MemoryVault()): NormalAccountViewModel {
        val account = NormalAccount(gateway, vault, h.repository, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), config)
        return NormalAccountViewModel(account, h.repository, config)
    }

    @Test fun viewModelActionsQueuedBeforeBackDoNoNetworkOrLatePublication() = runTest {
        kotlinx.coroutines.Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val dir = File.createTempFile("normal-vm-fence", "").apply { delete() }
            val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AyaDatabase::class.java).allowMainThreadQueries().build()
            val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
            try {
                val gateway = ViewModelGateway(); val vault = MemoryVault(); val vm = viewModel(h, gateway, vault)
                vm.signUp("owner@gmail.com", "synthetic-password", true)
                vm.confirm("owner@gmail.com", "111111", true)
                vm.signIn("owner@gmail.com", "synthetic-password", true)
                vm.resend("owner@gmail.com"); vm.recover("owner@gmail.com"); vm.reset("owner@gmail.com", "222222", "synthetic-password2")
                vm.signOut(); vm.restoreSession(); vm.syncNow(); vm.createLearner("Late", "id"); vm.enableSync(); vm.disableSync()
                vm.back()
                runCurrent()
                assertEquals(0, gateway.calls)
                assertNull(vault.value)
                assertNull(h.repository.state.value.owner)
                assertNull(h.repository.state.value.selected)
                assertNull(vm.state.value.account.message)
            } finally { h.stop(); db.close(); dir.deleteRecursively() }
        } finally { kotlinx.coroutines.Dispatchers.resetMain() }
    }

    @Test fun deviceCleanupClearsAllOriginNamespacesAndLateCredentialsCannotRepopulate() = runTest {
        val dir = File.createTempFile("normal-all-clear", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            com.google.crypto.tink.aead.AeadConfig.register()
            val aead = com.google.crypto.tink.KeysetHandle.generateNew(com.google.crypto.tink.KeyTemplates.get("AES128_GCM")).getPrimitive(com.google.crypto.tink.Aead::class.java)
            val vault = KeystoreNormalAuthVault(context, aead, config)
            val session = AuthSession("old-access", "old-refresh", 60, "bearer", AuthUser("owner", "owner@gmail.com", "confirmed"))
            vault.write(SavedNormalAuth(session, 1000, 1, config.publicOrigin))
            val other = config.copy(publicOrigin = "https://accounts-b.example.invalid")
            KeystoreNormalAuthVault(context, aead, other).write(SavedNormalAuth(session, 1000, 1, other.publicOrigin))
            FileJournal(File(dir, "normal-owner-sync/${other.environmentHash}/journal.json")).update { JournalSnapshot(activeOwner = "old-owner") }
            val gateway = ViewModelGateway()
            val account = NormalAccount(gateway, vault, h.repository, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), config)
            gateway.signInGate = kotlinx.coroutines.CompletableDeferred()
            val late = async { account.signIn("owner@gmail.com", "synthetic-password", true) }
            gateway.signInEntered.await()
            NormalAccountLocalCleaner(context, h.repository, account, h.visibility).deleteDevice()
            gateway.signInGate!!.complete(Unit)
            assertFalse(late.await())
            assertFalse(File(dir, "normal-owner-auth").exists())
            assertFalse(File(dir, "normal-owner-sync").exists())
            val fresh = newHarness(dir, api, db, active)
            assertNull(fresh.repository.state.value.owner)
            assertNull(fresh.repository.state.value.selected)
            assertTrue("A later legitimate sign-in must still work", account.signIn("owner@gmail.com", "synthetic-password", true))
            assertNotNull(vault.read())
            fresh.stop()
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }

    @Test fun cleanupFailureIsReportedAndDoesNotClaimAllFilesRemoved() = runTest {
        val dir = File.createTempFile("normal-clear-failure", "").apply { delete() }
        val base = ApplicationProvider.getApplicationContext<Context>()
        val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = dir.apply { mkdirs() } }
        val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
        val active = InMemoryActiveProfileStore(); val api = FakeBackend(); val h = newHarness(dir, api, db, active)
        try {
            val failing = object : NormalAuthVault {
                override fun read(): SavedNormalAuth? = null
                override fun write(value: SavedNormalAuth?) { if (value == null) error("synthetic vault clear failure") }
            }
            val account = NormalAccount(ViewModelGateway(), failing, h.repository, FixedClock(Instant.parse("2026-10-26T00:00:00Z")), config)
            val old = File(dir, "normal-owner-sync/old-environment/journal.json")
            FileJournal(old).update { JournalSnapshot(activeOwner = "old-owner") }
            assertThrows(IllegalStateException::class.java) {
                kotlinx.coroutines.runBlocking { NormalAccountLocalCleaner(context, h.repository, account, h.visibility).deleteDevice() }
            }
            assertTrue(old.exists())
        } finally { h.stop(); db.close(); dir.deleteRecursively() }
    }
}
