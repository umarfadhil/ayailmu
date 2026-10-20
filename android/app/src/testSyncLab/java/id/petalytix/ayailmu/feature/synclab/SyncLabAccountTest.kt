package id.petalytix.ayailmu.feature.synclab

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.aead.AeadConfig
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.settings.InMemoryActiveProfileStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.FixedClock
import id.petalytix.ayailmu.core.engine.SystemClock
import id.petalytix.ayailmu.core.sync.ApiFailure
import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.AuthUser
import id.petalytix.ayailmu.core.sync.Backend
import id.petalytix.ayailmu.core.sync.Catalog
import id.petalytix.ayailmu.core.sync.CatalogPack
import id.petalytix.ayailmu.core.sync.GoTrueAuth
import id.petalytix.ayailmu.core.sync.HttpBackend
import id.petalytix.ayailmu.core.sync.Learner
import id.petalytix.ayailmu.core.sync.PackProof
import id.petalytix.ayailmu.core.sync.Page
import id.petalytix.ayailmu.core.sync.Receipt
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLEncoder
import java.time.Instant
import kotlin.concurrent.thread
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private const val TEST_SOURCE_COMMIT = "815e30f0da284b9818fadc0143f4da92544384d3"

/** Tiny loopback HTTP server for tests (the app module's unit-test classpath hides com.sun.net.httpserver). */
private class MiniHttp(
    private val handler: (method: String, path: String, query: String, headers: Map<String, String>, body: String) -> Pair<Int, String>,
) {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    private val accept = thread {
        while (true) {
            try {
                val client = socket.accept()
                thread { handle(client) }
            } catch (e: Exception) {
                return@thread
            }
        }
    }
    private fun handle(client: Socket) {
        try {
            client.soTimeout = 10_000
            val input = client.getInputStream()
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val target = parts[1]
            val path = target.substringBefore("?")
            val query = target.substringAfter("?", "")
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val separator = line.indexOf(":")
                if (separator > 0) headers[line.substring(0, separator).trim().lowercase()] = line.substring(separator + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val body = if (length > 0) String(input.readNBytes(length)) else ""
            val (status, payload) = handler(parts[0], path, query, headers, body)
            val bytes = payload.encodeToByteArray()
            val head = buildString {
                append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n")
                append("Content-Type: application/json\r\n")
                append("Content-Length: ").append(bytes.size).append("\r\n")
                append("Connection: close\r\n\r\n")
            }.encodeToByteArray()
            client.getOutputStream().use { it.write(head); it.write(bytes) }
        } catch (e: Exception) {
            // Synthetic peer went away; nothing to clean up.
        } finally {
            try { client.close() } catch (e: Exception) { }
        }
    }
    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        var previous = -1
        while (true) {
            val byte = input.read()
            if (byte == -1) return if (out.size() == 0) null else out.toString()
            if (previous == '\r'.code && byte == '\n'.code) return out.toString().dropLast(1)
            out.write(byte)
            previous = byte
        }
    }
    private fun reason(status: Int) = when (status) {
        200 -> "OK"
        204 -> "No Content"
        400 -> "Bad Request"
        else -> "Synthetic"
    }
    fun stop() { socket.close() }
}

/** Local fake of the documented GoTrue v2 HTTP surface used by [GoTrueAuth]. */
private class FakeGoTrue {
    class User(val id: String, val email: String, var password: String, var confirmed: Boolean)
    val users = mutableMapOf<String, User>()
    val signupCodes = mutableMapOf<String, String>()
    val recoveryCodes = mutableMapOf<String, String>()
    val accessOwner = mutableMapOf<String, String>()
    val refreshOwner = mutableMapOf<String, String>()
    val expiredAccess = mutableSetOf<String>()
    val loggedOut = mutableListOf<String>()
    var refreshCalls = 0
    var tokenCalls = 0
    var refreshAsOtherUser = false
    var refreshStatus: Int? = null
    val refreshEntered = CompletableDeferred<Unit>()
    var refreshGate: java.util.concurrent.CountDownLatch? = null
    val signupEntered = CompletableDeferred<Unit>()
    var signupGate: java.util.concurrent.CountDownLatch? = null
    val verifyEntered = CompletableDeferred<Unit>()
    var verifyGate: java.util.concurrent.CountDownLatch? = null
    val pkceEntered = CompletableDeferred<Unit>()
    var pkceGate: java.util.concurrent.CountDownLatch? = null
    var next = 0
    val http = MiniHttp { method, path, query, headers, body -> route(method, path, query, headers, body) }

    /** Registers an already-confirmed fabricated adult account. */
    fun fabricate(email: String, password: String) {
        users[email] = User("user-${++next}", email, password, confirmed = true)
    }
    private fun route(method: String, path: String, query: String, headers: Map<String, String>, raw: String): Pair<Int, String> {
        val body = Json.parseToJsonElement(if (raw.isBlank()) "{}" else raw).jsonObject
        fun field(name: String) = body.getValue(name).jsonPrimitive.content
        fun bearer() = headers["authorization"].orEmpty().removePrefix("Bearer ")
        return when {
            path == "/signup" -> {
                signupEntered.complete(Unit)
                signupGate?.await()
                val email = field("email")
                users[email] = User("user-${++next}", email, field("password"), confirmed = false)
                signupCodes[email] = "111111"
                200 to "{}"
            }
            path == "/resend" -> { signupCodes[field("email")] = "111111"; 200 to "{}" }
            path == "/recover" -> { recoveryCodes[field("email")] = "222222"; 200 to "{}" }
            path == "/verify" -> {
                verifyEntered.complete(Unit)
                verifyGate?.await()
                val email = field("email"); val code = field("token"); val type = field("type")
                val expected = if (type == "signup") signupCodes[email] else recoveryCodes[email]
                val user = users[email]
                if (user == null || expected == null || expected != code) 400 to """{"error_code":"invalid_otp"}"""
                else { if (type == "signup") user.confirmed = true; 200 to session(user) }
            }
            path == "/token" && "grant_type=password" in query -> {
                tokenCalls++
                val user = users[field("email")]
                when {
                    user == null || user.password != field("password") -> 400 to """{"error_code":"invalid_credentials"}"""
                    !user.confirmed -> 400 to """{"error_code":"email_not_confirmed"}"""
                    else -> 200 to session(user)
                }
            }
            path == "/token" && "grant_type=refresh_token" in query -> {
                tokenCalls++
                refreshCalls++
                refreshEntered.complete(Unit)
                refreshGate?.await()
                if (refreshStatus != null) refreshStatus!! to """{"error_code":"temporarily_unavailable"}"""
                else {
                    val user = users.values.find { it.id == refreshOwner[field("refresh_token")] }
                    val other = if (refreshAsOtherUser) users.values.find { it.id != user?.id } else null
                    val issued = other ?: user
                    if (issued == null) 400 to """{"error_code":"invalid_grant"}""" else 200 to session(issued)
                }
            }
            path == "/token" && "grant_type=pkce" in query -> {
                tokenCalls++
                pkceEntered.complete(Unit)
                pkceGate?.await()
                val user = users.values.firstOrNull()
                if (user == null) 400 to """{"error_code":"invalid_request"}""" else 200 to session(user)
            }
            path == "/user" && method == "GET" -> 200 to userJson(users.values.first { it.id == accessOwner[bearer()] })
            path == "/user" -> {
                val user = users.values.first { it.id == accessOwner[bearer()] }
                user.password = field("password")
                200 to userJson(user)
            }
            path == "/logout" -> { loggedOut += bearer(); 204 to "" }
            else -> 400 to """{"error_code":"request_failed"}"""
        }
    }
    private fun session(user: User): String {
        val access = "access-${++next}"
        val refresh = "refresh-${++next}"
        accessOwner[access] = user.id
        refreshOwner[refresh] = user.id
        return """{"access_token":"$access","refresh_token":"$refresh","expires_in":60,"token_type":"bearer","user":${userJson(user)}}"""
    }
    private fun userJson(user: User) =
        """{"id":"${user.id}","email":"${user.email}","email_confirmed_at":"2026-10-19T00:00:00Z"}"""
}

/** Owner-scoped fake of the Go API: only unexpired GoTrue access tokens map to durable owners. */
private class FakeApi(
    private val fake: FakeGoTrue,
    private val catalog: Catalog = Catalog(TEST_SOURCE_COMMIT, emptyList()),
) : Backend {
    val accountEntered = CompletableDeferred<Unit>()
    var accountGate: CompletableDeferred<Unit>? = null
    val learnersEntered = CompletableDeferred<Unit>()
    var learnersGate: CompletableDeferred<Unit>? = null
    val currentEntered = CompletableDeferred<Unit>()
    var currentGate: java.util.concurrent.CountDownLatch? = null
    var serverError = false
    var failLearnersWith503 = false
    /** Fresh per-call milestones: every learners() call offers an entered and an exit deferred. */
    val learnersCalls = java.util.concurrent.LinkedBlockingQueue<CompletableDeferred<Unit>>()
    val learnersExits = java.util.concurrent.LinkedBlockingQueue<CompletableDeferred<Unit>>()
    /** Exact per-call pairing: entry and exit for the same invocation register together at call
     * entry, so an awaited exit can only ever belong to its own captured entered milestone. */
    val learnersPairs = java.util.concurrent.LinkedBlockingQueue<Pair<CompletableDeferred<Unit>, CompletableDeferred<Unit>>>()
    var failLearnersWith401 = false
    val profiles = mutableMapOf<String, MutableList<Learner>>()
    private fun owner(token: String): String {
        if (serverError) throw ApiFailure(503, "temporarily_unavailable")
        if (token !in fake.accessOwner || token in fake.expiredAccess) throw ApiFailure(401, "unauthorized")
        return "owner-" + fake.accessOwner.getValue(token)
    }
    override suspend fun account(token: String): String {
        accountEntered.complete(Unit)
        accountGate?.await()
        return owner(token)
    }
    override suspend fun currentAccount(token: String): String {
        currentEntered.complete(Unit)
        currentGate?.await()
        return owner(token)
    }
    override suspend fun learners(token: String): List<Learner> {
        val entered = CompletableDeferred<Unit>()
        val pairedExit = CompletableDeferred<Unit>()
        learnersPairs.add(entered to pairedExit)
        // Capture the gate before publishing the milestone, so a completed entered always means
        // this call already captured its gate (no scheduling gap).
        val gate = learnersGate
        learnersCalls.add(entered)
        learnersEntered.complete(Unit)
        var waited = false
        try {
            if (gate != null) {
                entered.complete(Unit)
                gate.await()
                waited = true
            } else {
                entered.complete(Unit)
            }
            val exit = CompletableDeferred<Unit>()
            learnersExits.add(exit)
            try {
                if (waited && failLearnersWith401) throw ApiFailure(401, "unauthorized")
                if (failLearnersWith503) throw ApiFailure(503, "temporarily_unavailable")
                return profiles[token].orEmpty()
            } finally {
                exit.complete(Unit)
            }
        } finally {
            // The paired terminal signal covers the whole invocation, including a caller cancelled
            // while waiting at the gate, so an exact pair can never dangle.
            pairedExit.complete(Unit)
        }
    }
    override suspend fun createLearner(token: String, clientId: String): Learner {
        owner(token)
        val learner = Learner("remote-$clientId", clientId, "ADULT", "adults", "id")
        profiles.getOrPut(token) { mutableListOf() }.add(learner)
        return learner
    }
    override suspend fun catalog(token: String): Catalog { owner(token); return catalog }
    override suspend fun consent(token: String, learnerId: String, granted: Boolean) { owner(token) }
    override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> = emptyList()
    override suspend fun pull(token: String, learnerId: String, after: Long): Page = Page(emptyList(), after, false)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class SyncLabAccountTest {
    private val base: Context = ApplicationProvider.getApplicationContext()

    private fun softwareAead(): Aead {
        AeadConfig.register()
        return KeysetHandle.generateNew(KeyTemplates.get("AES128_GCM")).getPrimitive(Aead::class.java)
    }
    private fun context(dir: File) = object : ContextWrapper(base) {
        override fun getNoBackupFilesDir() = dir.apply { mkdirs() }
    }
    private fun db(context: Context) = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
    private fun assets() = AssetSource { path ->
        requireNotNull(requireNotNull(javaClass.classLoader).getResourceAsStream(path)).use { it.readBytes().decodeToString() }
    }
    private fun pumpMain() {
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    /** Drives a ViewModel whose viewModelScope runs on the test scheduler (Dispatchers.setMain). */
    private suspend fun awaitCondition(scheduler: TestCoroutineScheduler, timeoutMs: Long, condition: () -> Boolean) {
        withContext(Dispatchers.Default) {
            withTimeoutOrNull(timeoutMs) {
                while (!condition()) {
                    scheduler.runCurrent()
                    kotlinx.coroutines.delay(10)
                }
            } ?: fail("Condition was not reached within ${timeoutMs}ms")
        }
    }

    private class Harness(
        dir: File,
        auth: GoTrueAuth,
        api: Backend,
        aead: Aead,
        val clock: Clock = FixedClock(Instant.parse("2026-10-19T02:00:00Z")),
        activeStore: id.petalytix.ayailmu.core.data.settings.ActiveProfileStore? = null,
    ) {
        val repository: SyncLabRepository
        val account: SyncLabAccount
        val vault: KeystoreAuthVault
        val active: InMemoryActiveProfileStore
        val context: Context
        val db: AyaDatabase
        init {
            context = object : ContextWrapper(ApplicationProvider.getApplicationContext<Context>()) {
                override fun getNoBackupFilesDir() = dir.apply { mkdirs() }
            }
            db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
            val assetSource = AssetSource { path ->
                requireNotNull(requireNotNull(javaClass.classLoader).getResourceAsStream(path)).use { it.readBytes().decodeToString() }
            }
            active = (activeStore as? InMemoryActiveProfileStore) ?: InMemoryActiveProfileStore()
            repository = SyncLabRepository(
                context, db, activeStore ?: active, assetSource, ContentRepository(assetSource, AppBuildInfo(true, "test")),
                SystemClock(), api,
            )
            vault = KeystoreAuthVault(context, aead)
            account = SyncLabAccount(auth, vault, repository, clock)
        }
    }
    private fun newHarness(dir: File, fake: FakeGoTrue, api: Backend = FakeApi(fake), aead: Aead = softwareAead(), clock: Clock = FixedClock(Instant.parse("2026-10-19T02:00:00Z"))) =
        Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), api, aead, clock)

    @Test fun vaultRoundTripsEncryptedAndFailsClosedOnCorruption() {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("vault", "").apply { delete() }
        try {
            val vault = KeystoreAuthVault(context(dir), softwareAead())
            assertNull(vault.read())
            val session = Json.decodeFromJsonElement<AuthSession>(
                Json.parseToJsonElement(
                    """{"access_token":"access-secret","refresh_token":"refresh-secret","expires_in":60,"token_type":"bearer","user":{"id":"user-9","email":"syn-vault@example.invalid"}}""",
                ),
            )
            vault.write(SavedAuth(session, expiresAtMs = 120_000, savedAtMs = 60_000))
            val restored = vault.read()
            assertNotNull(restored)
            assertEquals("access-secret", restored!!.session.accessToken)
            assertEquals("syn-vault@example.invalid", restored.session.user.email)
            val file = File(dir, "gotrue-auth/session.enc")
            assertFalse(file.readBytes().decodeToString().contains("access-secret"), "Persisted session must be ciphertext")
            // Corrupt ciphertext: read fails closed to "no saved session" and removes the unreadable file.
            file.writeBytes(ByteArray(file.readBytes().size) { (it % 251).toByte() })
            assertNull(vault.read())
            assertFalse(file.exists())
            vault.write(null)
            assertNull(vault.read())
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun signInPersistsSessionAndColdRestoreResumesSameOwner() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val first = newHarness(dir, fake, aead = aead)
            assertTrue(first.account.signIn("syn-a@example.invalid", "password-one"))
            assertEquals("syn-a@example.invalid", first.account.state.value.email)
            assertEquals("owner-user-1", first.repository.state.value.owner)
            val file = File(dir, "gotrue-auth/session.enc")
            assertFalse(file.readBytes().decodeToString().contains("access-"), "Vault must not store plaintext tokens")
            // Cold relaunch from the same no-backup directory restores the durable owner without a password.
            val second = newHarness(dir, fake, aead = aead)
            assertTrue(second.account.restore())
            assertEquals("syn-a@example.invalid", second.account.state.value.email)
            assertTrue(second.repository.state.value.authenticated)
            assertEquals(first.repository.state.value.owner, second.repository.state.value.owner)
            first.repository.stop(); second.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun expiredAccessTokenRotatesRefreshOnceAndRestores() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val first = newHarness(dir, fake, aead = aead)
            assertTrue(first.account.signIn("syn-a@example.invalid", "password-one"))
            val stale = first.vault.read()!!
            first.vault.write(stale.copy(expiresAtMs = 0))
            fake.expiredAccess += stale.session.accessToken
            val second = newHarness(dir, fake, aead = aead)
            assertTrue(second.account.restore())
            assertEquals(1, fake.refreshCalls, "Expired access token must rotate the refresh token exactly once")
            val rotated = second.vault.read()!!
            assertTrue(rotated.session.accessToken != stale.session.accessToken)
            assertTrue(rotated.session.refreshToken != stale.session.refreshToken)
            assertTrue(second.repository.state.value.authenticated)
            first.repository.stop(); second.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun concurrentRestoresSerializeRotationAndOneWins() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val first = newHarness(dir, fake, aead = aead)
            assertTrue(first.account.signIn("syn-a@example.invalid", "password-one"))
            val stale = first.vault.read()!!
            first.vault.write(stale.copy(expiresAtMs = 0))
            fake.expiredAccess += stale.session.accessToken
            val second = newHarness(dir, fake, aead = aead)
            val restoreA = async { second.account.restore() }
            val restoreB = async { second.account.restore() }
            val results = listOf(restoreA.await(), restoreB.await())
            assertEquals(listOf(true, true), results, "Coalesced restores both resume the durable owner")
            assertEquals(1, fake.refreshCalls, "Rotation must be serialized across restores")
            assertNotNull(second.vault.read())
            assertTrue(second.repository.state.value.authenticated)
            first.repository.stop(); second.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun signOutClearsLocalStateAndAttemptsProviderLogout() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            val access = harness.vault.read()!!.session.accessToken
            harness.account.signOut()
            assertNull(harness.vault.read())
            assertNull(harness.repository.state.value.owner)
            assertFalse(harness.repository.state.value.authenticated)
            assertEquals(listOf(access), fake.loggedOut)
            // The provider session is locally dead: a restore finds nothing durable to resume.
            assertFalse(harness.account.restore())
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun lateSignInCannotRestoreAfterSignOutStarts() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val gate = CompletableDeferred<Unit>()
        api.accountGate = gate
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val signingIn = async { harness.account.signIn("syn-a@example.invalid", "password-one") }
            api.accountEntered.await()
            val signedOut = async { harness.account.signOut() }
            signedOut.await()
            gate.complete(Unit)
            assertFalse(signingIn.await(), "A late sign-in response must not survive a concurrent sign-out")
            assertNull(harness.vault.read())
            assertNull(harness.repository.state.value.owner)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun signUpConfirmRecoverAndResetUseProviderOtp() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            val harness = newHarness(dir, fake)
            assertTrue(harness.account.signUp("syn-b@example.invalid", "password-two"))
            assertFalse(harness.account.signIn("syn-b@example.invalid", "password-two"))
            assertEquals(R.string.sync_lab_error_unconfirmed, harness.account.state.value.message)
            assertTrue(harness.account.confirm("syn-b@example.invalid", "111111"))
            assertTrue(harness.repository.state.value.authenticated)
            assertEquals("syn-b@example.invalid", harness.account.state.value.email)
            // Recovery: code from the synthetic inbox, then a fresh password; the recovery session ends.
            assertTrue(harness.account.recover("syn-b@example.invalid"))
            assertTrue(harness.account.reset("syn-b@example.invalid", "222222", "password-three"))
            assertTrue(fake.loggedOut.isNotEmpty(), "Recovery session must be ended after the password update")
            assertFalse(harness.account.signIn("syn-b@example.invalid", "password-two"))
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-three"))
            assertEquals("password-three", fake.users.getValue("syn-b@example.invalid").password)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun googlePreparationFailsClosedUntilSetupApproved() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val clock = FixedClock(Instant.parse("2026-10-19T02:00:00Z"))
            val harness = newHarness(dir, fake, clock = clock)
            val url = harness.account.beginGoogle()!!
            assertTrue(url.startsWith("http://127.0.0.1:${fake.http.port}/authorize?provider=google"))
            assertTrue(url.contains("code_challenge_method=s256"))
            val state = harness.account.googleState()!!
            assertTrue(url.contains(URLEncoder.encode("id.petalytix.ayailmu.synclab://auth-callback/$state", "UTF-8")))
            assertFalse(url.contains("client_secret"))
            // A pending intent completes once with its exact state; replays and wrong states fail closed.
            assertTrue(harness.account.completeGoogle(state, "auth-code-1"))
            assertFalse(harness.account.completeGoogle(state, "auth-code-1"))
            harness.account.signOut()
            val second = harness.account.beginGoogle()!!
            assertFalse(harness.account.completeGoogle("wrong-state", "auth-code-2"))
            // Cancellation fails closed.
            val third = harness.account.beginGoogle()!!
            val state3 = harness.account.googleState()!!
            harness.account.cancelGoogle()
            assertFalse(harness.account.completeGoogle(state3, "auth-code-3"))
            // Any account change (e.g. sign-out) invalidates the pending intent generation.
            fake.fabricate("syn-c@example.invalid", "password-four")
            val fourth = harness.account.beginGoogle()!!
            val state4 = harness.account.googleState()!!
            harness.account.signOut()
            assertFalse(harness.account.completeGoogle(state4, "auth-code-4"))
            // A stale intent expires without exchanging; a clock rollback also fails closed.
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state5 = harness.account.googleState()!!
            clock.advanceSeconds(601)
            assertFalse(harness.account.completeGoogle(state5, "auth-code-5"))
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state6 = harness.account.googleState()!!
            clock.advanceSeconds(-3601)
            assertFalse(harness.account.completeGoogle(state6, "auth-code-6"))
            assertEquals(1, fake.tokenCalls, "Only the first exchange reached the provider")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun syntheticDomainIsRejectedBeforeAnyNetworkCall() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            val harness = newHarness(dir, fake)
            val requestsBefore = fake.refreshCalls
            assertFalse(harness.account.signIn("real.person@gmail.com", "password-one"))
            assertEquals(R.string.sync_lab_error_synthetic, harness.account.state.value.message)
            assertFalse(harness.account.signUp("real.child@school.edu", "password-one"))
            assertFalse(harness.account.confirm("real.person@gmail.com", "111111"))
            assertFalse(harness.account.recover("real.person@gmail.com"))
            assertFalse(harness.account.resend("real.person@gmail.com"))
            assertFalse(harness.account.reset("real.person@gmail.com", "222222", "password-two"))
            assertEquals(requestsBefore, fake.refreshCalls)
            assertTrue(fake.accessOwner.isEmpty(), "No authentication request may reach the provider")
            assertNull(harness.vault.read())
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun lateSignInCannotOverwriteANewerSignedInAccount() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val gate = CompletableDeferred<Unit>()
        api.accountGate = gate
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val aead = softwareAead()
            val harness = newHarness(dir, fake, api, aead = aead)
            val signingInA = async { harness.account.signIn("syn-a@example.invalid", "password-one") }
            api.accountEntered.await()
            val signingInB = async { harness.account.signIn("syn-b@example.invalid", "password-two") }
            gate.complete(Unit)
            assertFalse(signingInA.await(), "The superseded sign-in must fail")
            assertTrue(signingInB.await(), "The newer sign-in must win")
            assertEquals("syn-b@example.invalid", harness.vault.read()!!.session.user.email)
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun failedRestoreCannotClearANewerSession() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val harness = newHarness(dir, fake, aead = aead)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            // Plant an expired session with an unknown refresh token, then block the provider refresh.
            harness.vault.write(
                SavedAuth(
                    AuthSession("access-dead", "refresh-unknown", 60, "bearer", AuthUser("user-1", "syn-a@example.invalid")),
                    expiresAtMs = 0, savedAtMs = 0,
                ),
            )
            fake.expiredAccess += "access-dead"
            val refreshGate = java.util.concurrent.CountDownLatch(1)
            fake.refreshGate = refreshGate
            val restoring = async { harness.account.restore() }
            fake.refreshEntered.await()
            // Milestone: the newer session installs while the stale refresh is still blocked at the provider.
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            val newer = harness.vault.read()!!
            assertFalse(restoring.isCompleted, "The stale restore must still be blocked before the release")
            withContext(Dispatchers.Default) { refreshGate.countDown() }
            // Failsafe below the client's 5s read timeout: progress must come from the gate, never from a timeout.
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { restoring.await() } }, "The stale restore must fail")
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken, "Stale failure must not wipe the newer session")
            assertTrue(harness.repository.state.value.authenticated)
            assertNull(harness.account.state.value.message, "A superseded failure must not publish over the newer account")

            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun failedRestoreClearsOnlyConclusivelyInvalidMaterial() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            // Plant an expired session whose refresh token the provider conclusively rejects (400, no gate):
            // the restore must fail through the invalid-grant path (generic message), not any network timeout
            // (which would surface as the offline message), and the unusable material must be cleared.
            harness.vault.write(
                SavedAuth(
                    AuthSession("access-dead", "refresh-unknown", 60, "bearer", AuthUser("user-1", "syn-a@example.invalid")),
                    expiresAtMs = 0, savedAtMs = 0,
                ),
            )
            fake.expiredAccess += "access-dead"
            assertFalse(harness.account.restore())
            assertEquals(R.string.sync_lab_error_generic, harness.account.state.value.message, "Invalid grant must surface as the conclusive-failure message, not an offline timeout")
            assertNull(harness.vault.read(), "Conclusively invalid material must be cleared")
            assertFalse(harness.repository.state.value.authenticated)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun transientApiFailurePreservesCredentialsForRetry() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.vault.write(harness.vault.read()!!.copy(expiresAtMs = 0))
            fake.expiredAccess += harness.vault.read()!!.session.accessToken
            api.serverError = true
            assertFalse(harness.account.restore(), "A transient 503 must fail the restore")
            assertNotNull(harness.vault.read(), "Transient failures must preserve the persisted session for retry")
            api.serverError = false
            assertTrue(harness.account.restore(), "The preserved session must restore once the API recovers")
            assertTrue(harness.repository.state.value.authenticated)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun staleTransientFailureDoesNotDisturbNewerAccount() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake, api)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.vault.write(harness.vault.read()!!.copy(expiresAtMs = 0))
            fake.expiredAccess += harness.vault.read()!!.session.accessToken
            val gate = java.util.concurrent.CountDownLatch(1)
            api.currentGate = gate
            val restoring = async { harness.account.restore() }
            api.currentEntered.await()
            // Milestone: the newer account installs while the stale restore is blocked before the API call.
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            val newer = harness.vault.read()!!
            api.serverError = true
            gate.countDown()
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { restoring.await() } }, "The stale restore must fail without touching the newer account")
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken, "A stale transient failure must not clear the newer session")
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            assertNull(harness.account.state.value.message, "A stale failure must not publish over the newer account")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun staleSignInLearnerFailureDoesNotPublishOverNewerAccount() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake, api)
            val gate = CompletableDeferred<Unit>()
            api.learnersGate = gate
            val aSignIn = async { harness.account.signIn("syn-a@example.invalid", "password-one") }
            // Park A's learner load inside the gate; a completed entered milestone means this
            // exact call already captured the gate, so clearing the field cannot release it.
            val aEntered = withContext(Dispatchers.Default) { withTimeout(4_000) { api.learnersCalls.take() } }
            aEntered.await()
            // The newer sign-in's learner load must pass: clear only the gate field, which A's
            // parked call captured by value.
            api.learnersGate = null
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            val newer = harness.vault.read()!!
            val newerNotice = harness.repository.state.value.notice
            assertEquals(R.string.sync_lab_saved, newerNotice, "The newer sign-in publishes its own saved notice")
            api.failLearnersWith503 = true
            gate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { aSignIn.await() } }
            assertEquals(newerNotice, harness.repository.state.value.notice, "A stale learner-load failure must not publish over the newer account")
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated, "The newer session stays active")
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken, "The newer session stays in the vault")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    /**
     * A's parked learner load fails with 503 after its owner pre-check, but the failure publish
     * then holds the publication boundary while a different-owner sign-in changes the engine
     * account; the stale failure notice must never be applied tagged as the newer owner, and the
     * newer sign-in's own success must not be able to hide the intermediate stale publication.
     */
    @Test fun staleLearnerFailureDroppedAcrossPublishWaitByDifferentOwnerSignIn() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake, api)
            val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                val gate = CompletableDeferred<Unit>()
                api.learnersGate = gate
                val committed = java.util.concurrent.CopyOnWriteArrayList<Pair<Int, String?>>()
                val bSignIn = CompletableDeferred<Deferred<Boolean>>()
                val once = java.util.concurrent.atomic.AtomicBoolean()
                harness.repository.publishProbe = probe@{ message ->
                    // Under publishLock this is exactly the state committed by the previous
                    // publish, so B's later success cannot hide an intermediate stale A commit.
                    committed += harness.repository.state.value.notice to harness.repository.state.value.owner
                    if (message == R.string.sync_lab_failed && once.compareAndSet(false, true)) {
                        // A is inside publishLock with its pre-check already passed; start B and let
                        // it change the engine account (B's own publish queues on this same boundary).
                        bSignIn.complete(ioScope.async { harness.account.signIn("syn-b@example.invalid", "password-two") })
                        withContext(Dispatchers.Default) {
                            withTimeout(8_000) {
                                while (harness.repository.savedOwner() != "owner-user-2") kotlinx.coroutines.delay(5)
                            }
                        }
                        api.learnersGate = null
                        api.failLearnersWith503 = false
                    }
                }
                val aSignIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }
                // Park A's learner load; a completed entered milestone means this exact call captured
                // the gate, so clearing the field cannot release it.
                val aEntered = withContext(Dispatchers.Default) { withTimeout(4_000) { api.learnersCalls.take() } }
                aEntered.await()
                api.failLearnersWith503 = true
                gate.complete(Unit)
                val newer = withContext(Dispatchers.Default) { withTimeout(10_000) { bSignIn.await() } }
                withContext(Dispatchers.Default) {
                    assertFalse(withTimeout(10_000) { aSignIn.await() }, "A's superseded sign-in must fail closed")
                    assertTrue(withTimeout(10_000) { newer.await() }, "B's sign-in succeeds")
                }
                assertTrue(committed.none { it.first == R.string.sync_lab_failed && it.second == "owner-user-2" },
                    "A stale learner-load failure must never be committed tagged as the newer owner: $committed")
                assertEquals("owner-user-2", harness.repository.state.value.owner)
                assertTrue(harness.repository.state.value.authenticated, "B's session stays active")
                assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice)
                val saved = harness.vault.read()
                assertNotNull(saved, "B's session is persisted")
                assertEquals("user-2", fake.accessOwner[saved!!.session.accessToken], "The vault holds B's session, not A's")
            } finally {
                runCatching { harness.repository.stop() }
                ioScope.cancel()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    /**
     * Same defect with a same-owner replacement: A's parked learner load fails with 503 after its
     * pre-check, then the failure publish holds the publication boundary while a fresh sign-in of
     * the same account supersedes A's attempt (the engine owner string is unchanged, only the
     * session attempt moves on); the stale failure notice must still be dropped.
     */
    @Test fun staleLearnerFailureDroppedAcrossPublishWaitBySameOwnerReplacement() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"), "The first sign-in completes")
                val firstToken = harness.vault.read()!!.session.accessToken
                val gate = CompletableDeferred<Unit>()
                api.learnersGate = gate
                var parkedMark = -1L
                val committed = java.util.concurrent.CopyOnWriteArrayList<Pair<Int, String?>>()
                val replacement = CompletableDeferred<Deferred<Boolean>>()
                val once = java.util.concurrent.atomic.AtomicBoolean()
                harness.repository.publishProbe = probe@{ message ->
                    committed += harness.repository.state.value.notice to harness.repository.state.value.owner
                    if (message == R.string.sync_lab_failed && once.compareAndSet(false, true)) {
                        replacement.complete(ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") })
                        withContext(Dispatchers.Default) {
                            withTimeout(8_000) {
                                while (harness.repository.sessionMark() == parkedMark) kotlinx.coroutines.delay(5)
                            }
                        }
                        api.learnersGate = null
                        api.failLearnersWith503 = false
                    }
                }
                val aSignIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }
                // The parked retry is the second learners() call; the first belongs to the completed
                // sign-in above.
                withContext(Dispatchers.Default) { withTimeout(4_000) { api.learnersCalls.take() } }.await()
                val parkedCall = withContext(Dispatchers.Default) { withTimeout(4_000) { api.learnersCalls.take() } }
                parkedCall.await()
                parkedMark = harness.repository.sessionMark()
                api.failLearnersWith503 = true
                gate.complete(Unit)
                val newer = withContext(Dispatchers.Default) { withTimeout(10_000) { replacement.await() } }
                withContext(Dispatchers.Default) {
                    assertFalse(withTimeout(10_000) { aSignIn.await() }, "The superseded sign-in must fail closed")
                    assertTrue(withTimeout(10_000) { newer.await() }, "The replacement sign-in succeeds")
                }
                assertTrue(committed.none { it.first == R.string.sync_lab_failed },
                    "A stale learner-load failure must never be committed after a same-owner replacement: $committed")
                assertEquals("owner-user-1", harness.repository.state.value.owner)
                assertTrue(harness.repository.state.value.authenticated, "The replacement session stays active")
                assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice)
                val saved = harness.vault.read()
                assertNotNull(saved, "The replacement session is persisted")
                assertEquals("user-1", fake.accessOwner[saved!!.session.accessToken], "The vault holds the same owner's session")
                assertNotEquals(firstToken, saved.session.accessToken, "The replacement session is a fresh one")
            } finally {
                runCatching { harness.repository.stop() }
                ioScope.cancel()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun signOutIsImmediateDespiteInFlightRefreshAndStorageFailure() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val harness = newHarness(dir, fake, aead = aead)
            val backing = KeystoreAuthVault(context(dir), aead)
            val storage = object : AuthVault {
                var fail = false
                override fun read(): SavedAuth? = backing.read()
                override fun write(value: SavedAuth?) {
                    if (fail) throw java.io.IOException("Synthetic storage failure")
                    backing.write(value)
                }
            }
            val account = SyncLabAccount(GoTrueAuth("http://127.0.0.1:${fake.http.port}"), storage, harness.repository, FixedClock(Instant.parse("2026-10-19T02:00:00Z")))
            assertTrue(account.signIn("syn-a@example.invalid", "password-one"))
            storage.fail = true
            // In-flight refresh blocked at the provider while logout must still complete immediately.
            harness.vault.write(harness.vault.read()!!.copy(expiresAtMs = 0))
            fake.expiredAccess += harness.vault.read()!!.session.accessToken
            val refreshGate = java.util.concurrent.CountDownLatch(1)
            fake.refreshGate = refreshGate
            val refreshing = async { account.refreshSession() }
            fake.refreshEntered.await()
            account.signOut()
            assertNull(harness.repository.state.value.owner, "Local logout must be immediate")
            assertFalse(harness.repository.state.value.authenticated)
            refreshGate.countDown()
            // Failsafe below the client's 5s read timeout: progress must come from the gate, never a timeout.
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { refreshing.await() } }, "The late refresh cannot complete after logout")
            assertTrue(fake.loggedOut.isNotEmpty(), "Provider logout is still attempted best-effort")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun oldLogoutCannotClearNewerSession() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val aead = softwareAead()
            // Gate only the active-profile clear so the old logout suspends inside local cleanup.
            val storeEntered = CompletableDeferred<Unit>()
            val gate = CompletableDeferred<Unit>()
            val delegate = InMemoryActiveProfileStore()
            val gatedStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) {
                    if (id == null) { storeEntered.complete(Unit); gate.await() }
                    delegate.setActive(id)
                }
            }
            val harness = Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), FakeApi(fake), aead, activeStore = gatedStore)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            val signingOut = async { harness.account.signOut() }
            storeEntered.await()
            // Milestone: B fully installs while A's logout is still suspended in local cleanup.
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            val newer = harness.vault.read()!!
            gate.complete(Unit)
            signingOut.await()
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken, "An old logout must never erase the newer account's credentials")
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated)
            assertEquals("syn-b@example.invalid", harness.account.state.value.email, "An old logout must never blank the newer account's UI")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun logoutCleansUpIndependentlyWhenActiveStoreFails() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val delegate = InMemoryActiveProfileStore()
            val failingStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) { throw java.io.IOException("Synthetic active-store failure") }
            }
            val harness = Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), FakeApi(fake), softwareAead(), activeStore = failingStore)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            val access = harness.vault.read()!!.session.accessToken
            harness.account.signOut()
            assertNull(harness.vault.read(), "The vault must be cleared even when the active-profile store fails")
            assertNull(harness.repository.state.value.owner)
            assertFalse(harness.repository.state.value.authenticated)
            assertFalse(harness.account.state.value.busy, "Busy must reset even when a local store fails")
            assertEquals(listOf(access), fake.loggedOut, "Provider logout is still attempted best-effort")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun signInVaultInstallFailureLeavesNoLiveSession() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val aead = softwareAead()
            val harness = newHarness(dir, fake, aead = aead)
            val backing = KeystoreAuthVault(context(dir), aead)
            val storage = object : AuthVault {
                var fail = false
                override fun read(): SavedAuth? = backing.read()
                override fun write(value: SavedAuth?) {
                    if (fail) throw java.io.IOException("Synthetic vault failure")
                    backing.write(value)
                }
            }
            val account = SyncLabAccount(GoTrueAuth("http://127.0.0.1:${fake.http.port}"), storage, harness.repository, FixedClock(Instant.parse("2026-10-19T02:00:00Z")))
            assertTrue(account.signIn("syn-a@example.invalid", "password-one"))
            storage.fail = true
            // B's provider login succeeds but the credential installation fails: the result must be
            // false with no live session behind it, and the stale A material must not resurrect.
            assertFalse(account.signIn("syn-b@example.invalid", "password-two"))
            assertFalse(harness.repository.state.value.authenticated, "A failed installation must not leave an authenticated repository")
            storage.fail = false
            assertFalse(account.restore(), "Stale material must fail closed against the newer durable owner")
            assertNull(storage.read(), "The owner mismatch must clear the stale material")
            assertTrue(account.signIn("syn-b@example.invalid", "password-two"))
            assertTrue(harness.repository.state.value.authenticated)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun staleSignupSuccessDoesNotPublishOrReturnSuccess() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            val harness = newHarness(dir, fake)
            val gate = java.util.concurrent.CountDownLatch(1)
            fake.signupGate = gate
            val signingUp = async { harness.account.signUp("syn-a@example.invalid", "password-one") }
            fake.signupEntered.await()
            // A different flow supersedes the in-flight signup before its response lands.
            assertTrue(harness.account.recover("syn-b@example.invalid"))
            gate.countDown()
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { signingUp.await() } }, "A superseded signup must not report success")
            assertNull(harness.account.state.value.message, "A superseded signup must not publish its result over the newer flow")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun staleResetDoesNotAffectNewerSession() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake)
            assertTrue(harness.account.recover("syn-a@example.invalid"))
            val gate = java.util.concurrent.CountDownLatch(1)
            fake.verifyGate = gate
            val resetting = async { harness.account.reset("syn-a@example.invalid", "222222", "password-new") }
            fake.verifyEntered.await()
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            val newer = harness.vault.read()!!
            gate.countDown()
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { resetting.await() } }, "A superseded reset must not report success")
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken)
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun cancelGoogleInvalidatesInFlightExchange() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake)
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state = harness.account.googleState()!!
            val gate = java.util.concurrent.CountDownLatch(1)
            fake.pkceGate = gate
            val completing = async { harness.account.completeGoogle(state, "auth-code") }
            fake.pkceEntered.await()
            harness.account.cancelGoogle()
            gate.countDown()
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { completing.await() } }, "A cancelled in-flight exchange must be discarded")
            assertFalse(harness.repository.state.value.authenticated)
            assertNull(harness.vault.read())
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun initActivationIsOrderedWithLogout() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val aead = softwareAead()
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val api = FakeApi(fake, proofCatalog)
            val first = newHarness(dir, fake, api, aead = aead)
            assertTrue(first.account.signIn("syn-a@example.invalid", "password-one"))
            first.repository.create()
            assertNotNull(first.repository.state.value.selected)
            first.repository.stop()
            // Simulated restart: a fresh repository reads the durable binding and begins local
            // activation, which blocks inside the ordering boundary.
            val storeEntered = CompletableDeferred<Unit>()
            val gate = java.util.concurrent.CountDownLatch(1)
            val delegate = InMemoryActiveProfileStore()
            val gatedStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) { storeEntered.complete(Unit); gate.await(); delegate.setActive(id) }
            }
            val context = object : ContextWrapper(base) {
                override fun getNoBackupFilesDir() = dir.apply { mkdirs() }
            }
            val db = db(context)
            val assetSource = assets()
            val restarted = SyncLabRepository(
                context, db, gatedStore, assetSource, ContentRepository(assetSource, AppBuildInfo(true, "test")),
                SystemClock(), api,
            )
            storeEntered.await()
            val loggingOut = async { restarted.logout() }
            delay(100)
            assertFalse(loggingOut.isCompleted, "Logout must wait for the in-progress local activation boundary")
            gate.countDown()
            assertTrue(loggingOut.await())
            assertNull(delegate.activeId.first(), "Logout must leave no stale active profile behind")
            assertNull(restarted.state.value.owner)
            assertNull(restarted.state.value.selected)
            restarted.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun lateActivationCannotOwnCurrentSession() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        val gate = java.util.concurrent.CountDownLatch(1)
        var restarted: SyncLabRepository? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val aead = softwareAead()
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val api = FakeApi(fake, proofCatalog)
            val first = newHarness(dir, fake, api, aead = aead)
            assertTrue(first.account.signIn("syn-a@example.invalid", "password-one"))
            first.repository.create()
            val aProfile = first.repository.state.value.selected!!.clientLearnerId
            first.repository.stop()
            // Simulated restart: init begins activating A's durable binding and parks inside the
            // active-store write while holding the local boundary. The requested id is captured as
            // the precondition milestone; the applied value is recorded only after the delegate
            // store accepted it, so the observed sequence is the actual A write then compensating clear.
            val requested = CompletableDeferred<String?>()
            val applied = java.util.concurrent.CopyOnWriteArrayList<String?>()
            val delegate = InMemoryActiveProfileStore()
            val gatedStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) {
                    requested.complete(id)
                    gate.await()
                    delegate.setActive(id)
                    applied.add(id)
                }
            }
            val context = object : ContextWrapper(base) {
                override fun getNoBackupFilesDir() = dir.apply { mkdirs() }
            }
            val r = SyncLabRepository(
                context, db(context), gatedStore, assets(), ContentRepository(assets(), AppBuildInfo(true, "test")),
                SystemClock(), api,
            )
            restarted = r
            val requestedId = withContext(Dispatchers.Default) { withTimeout(4_000) { requested.await() } }
            assertEquals(aProfile, requestedId, "The parked write is A's activation, not an initial null")
            assertFalse(r.initJob.isCompleted, "Init stays pending while its store milestone is held")
            // B (with no binding) signs in and changes ownership while A's activation is parked.
            val bVault = KeystoreAuthVault(context, aead)
            val account = SyncLabAccount(GoTrueAuth("http://127.0.0.1:${fake.http.port}"), bVault, r, FixedClock(Instant.parse("2026-10-19T02:00:00Z")))
            assertTrue(account.signIn("syn-b@example.invalid", "password-two"))
            assertEquals(LearningReadiness.NOT_READY, r.prepareLearning(), "B with no binding cannot open learning while A's activation is parked")
            val saved = assertNotNull(bVault.read(), "B's session is persisted")
            val owner = r.state.value.owner
            gate.countDown()
            // Join the exact init activation job: A's stale activation is undone before it completes.
            withContext(Dispatchers.Default) { withTimeout(4_000) { r.initJob.join() } }
            assertFalse(r.initJob.isActive)
            assertEquals(listOf(aProfile, null), applied.toList(), "A's late write is applied, then compensated with a clear")
            assertEquals(owner, r.state.value.owner)
            assertEquals("owner-user-2", r.state.value.owner)
            assertTrue(r.state.value.authenticated)
            assertNull(delegate.activeId.first(), "A stale activation must never leave A active after B signed in")
            val kept = assertNotNull(bVault.read(), "B's credentials must survive the stale activation")
            assertEquals(saved, kept, "The whole SavedAuth snapshot is unchanged")
            r.stop()
        } finally {
            gate.countDown()
            restarted?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.initJob.join() } } } }
            runCatching { restarted?.stop() }
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun googleCancelDuringLearnerLoadDiscardsSession() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state = harness.account.googleState()!!
            val learnersGate = CompletableDeferred<Unit>()
            api.learnersGate = learnersGate
            val completing = async { harness.account.completeGoogle(state, "auth-code") }
            api.learnersEntered.await()
            // The PKCE exchange succeeded; the flow is cancelled while the backend learner load is pending.
            harness.account.cancelGoogle()
            learnersGate.complete(Unit)
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { completing.await() } }, "A flow cancelled during learner load must be discarded")
            assertFalse(harness.repository.state.value.authenticated, "A cancelled attempt must leave no live authentication")
            assertNull(harness.vault.read(), "A cancelled attempt must never install credentials")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

@Test fun googleRejectsWhenASessionAlreadyExists() = runTest {
        // Prepared Google sign-in is sign-in-only: linking/re-auth on an existing session is
        // rejected without touching the genuine credentials, session, selection or active profile.
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val harness = newHarness(dir, fake, FakeApi(fake, proofCatalog))
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.repository.create()
            val selected = assertNotNull(harness.repository.state.value.selected)
            val activeProfile = assertNotNull(harness.active.activeId.first())
            val callsBefore = fake.tokenCalls
            assertNull(harness.account.beginGoogle(), "beginGoogle must reject when a session exists")
            assertNull(harness.account.googleState())
            assertFalse(harness.account.completeGoogle("any-state", "any-code"), "Without a pending intent no code may be exchanged")
            assertEquals(callsBefore, fake.tokenCalls, "The rejected attempt never reaches the provider")
            assertEquals("syn-a@example.invalid", harness.vault.read()!!.session.user.email, "Existing vault session preserved")
            assertEquals("owner-user-1", harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated)
            assertEquals(selected.id, harness.repository.state.value.selected!!.id)
            assertEquals(activeProfile, harness.active.activeId.first())
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

@Test fun googleCancelDuringLoadPreservesSignedOutStateForRestore() = runTest {
        // Signed-out precondition; a cancelled in-flight attempt installs nothing and leaves
        // the fully signed-out state intact.
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val api = FakeApi(fake, proofCatalog)
            val harness = newHarness(dir, fake, api)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.repository.create()
            assertNotNull(harness.repository.state.value.selected)
            harness.account.signOut()
            assertNull(harness.repository.state.value.owner)
            // Drain every completed setup learners registration (sign-in, select, create) so the
            // Google flow's fresh call is the one whose captured gate is awaited below.
            while (true) {
                val drained = withContext(Dispatchers.Default) {
                    api.learnersCalls.poll(200, java.util.concurrent.TimeUnit.MILLISECONDS)
                } ?: break
                drained.await()
            }
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state = harness.account.googleState()!!
            val learnersGate = CompletableDeferred<Unit>()
            api.learnersGate = learnersGate
            val completing = async { harness.account.completeGoogle(state, "auth-code") }
            val parked = withContext(Dispatchers.Default) {
                withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parked, "The Google flow's learners call must enter and capture its gate")
            parked!!.await()
            assertNotNull(harness.repository.savedOwner(), "The Google attempt introduced a durable owner before the cancel")
            assertTrue(harness.repository.state.value.authenticated, "The Google attempt introduced live auth before the cancel")
            harness.account.cancelGoogle()
            learnersGate.complete(Unit)
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { completing.await() } }, "A flow cancelled during learner load must be discarded")
            assertNull(harness.vault.read(), "A cancelled attempt must never install credentials")
            assertFalse(harness.repository.state.value.authenticated)
            assertNull(harness.repository.savedOwner(), "The cancelled attempt must leave no durable owner")
            assertNull(harness.repository.state.value.owner)
            assertNull(harness.active.activeId.first(), "No profile may remain selected for the cancelled attempt")
            assertFalse(harness.account.state.value.busy, "Cancellation cleanup must clear busy")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun failedActiveStoreFailsLearningClosed() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val delegate = InMemoryActiveProfileStore()
            val failingStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) { throw java.io.IOException("Synthetic active-store failure") }
            }
            val harness = Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), FakeApi(fake, proofCatalog), softwareAead(), activeStore = failingStore)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.repository.create()
            assertNull(delegate.activeId.first(), "A failed activation must never publish an active profile")
            assertEquals(LearningReadiness.NOT_READY, harness.repository.prepareLearning(), "Learning must fail closed when the active-profile store fails")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun disposedRouteDoesNotNavigateOnDelayedSignup() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("account", "").apply { delete() }
            try {
                val harness = newHarness(dir, fake)
                val vm = SyncLabViewModel(harness.repository, harness.account)
                val origin = Any()
                vm.routeVisible(origin)
                val gate = java.util.concurrent.CountDownLatch(1)
                fake.signupGate = gate
                var navigated = false
                vm.signUp("syn-a@example.invalid", "password-one", origin) { navigated = true }
                testScheduler.runCurrent()
                fake.signupEntered.await()
                vm.routeGone(origin)
                gate.countDown()
                awaitCondition(testScheduler, 4_000) { !harness.account.state.value.busy }
                assertFalse(navigated, "A route disposed before completion must not navigate")
                harness.repository.stop()
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun keptRouteNavigatesOnCompletion() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("account", "").apply { delete() }
            try {
                val harness = newHarness(dir, fake)
                val vm = SyncLabViewModel(harness.repository, harness.account)
                val origin = Any()
                vm.routeVisible(origin)
                var navigated = false
                vm.signUp("syn-a@example.invalid", "password-one", origin) { navigated = true }
                testScheduler.runCurrent()
                awaitCondition(testScheduler, 4_000) { !harness.account.state.value.busy }
                assertTrue(navigated, "A still-visible route must receive its completion navigation")
                harness.repository.stop()
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun disposedRouteDoesNotNavigateButInstalledSessionSurvives() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val fake = FakeGoTrue()
            val api = FakeApi(fake)
            val dir = File.createTempFile("account", "").apply { delete() }
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                val harness = newHarness(dir, fake, api)
                val vm = SyncLabViewModel(harness.repository, harness.account)
                val gate = CompletableDeferred<Unit>()
                api.accountGate = gate
                val origin = Any()
                vm.routeVisible(origin)
                var navigated = false
                vm.signIn("syn-a@example.invalid", "password-one", origin) { navigated = true }
                testScheduler.runCurrent()
                api.accountEntered.await()
                vm.routeGone(origin)
                gate.complete(Unit)
                awaitCondition(testScheduler, 4_000) { !harness.account.state.value.busy }
                assertFalse(navigated, "Disposing the route must suppress its navigation callback")
                assertTrue(harness.repository.state.value.authenticated, "The completed sign-in must still install its session")
                harness.repository.stop()
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun staleOrdinaryActionFailureDoesNotExpireNewerSession() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        val gate = CompletableDeferred<Unit>()
        var refreshing: kotlinx.coroutines.Job? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake, api)
            val vm = SyncLabViewModel(harness.repository, harness.account)
            testScheduler.runCurrent() // drain the empty-vault restore before any account exists
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            // Drain the initial sign-in's exact entry/exit pair.
            val initial = withContext(Dispatchers.Default) { api.learnersPairs.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            assertNotNull(initial, "The sign-in's learner load must register its entry/exit pair")
            initial!!.first.await()
            initial.second.await()
            // A's "Load this account's learners" begins and parks at a fresh per-request call.
            api.learnersGate = gate
            val refreshingJob = vm.refresh().also { refreshing = it }
            testScheduler.runCurrent()
            val gatedCall = withContext(Dispatchers.Default) { api.learnersPairs.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            assertNotNull(gatedCall, "The later request must register its own entry/exit pair")
            gatedCall!!.first.await() // entered completes only after the call captured its gate
            assertFalse(refreshingJob.isCompleted, "The action stays pending while its learners milestone is held")
            // A logs out and B signs in while A's old request is still suspended at the backend.
            // Clearing the field first lets B's own learner load through; the parked call keeps its
            // captured gate and is released afterwards with a 401.
            harness.account.signOut()
            api.learnersGate = null
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            assertTrue(harness.repository.state.value.authenticated)
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            val saved = assertNotNull(harness.vault.read(), "B's session is persisted")
            // The old request is released with a 401; its own paired exit is awaited exactly, then
            // the action Job is joined through its failure handler.
            api.failLearnersWith401 = true
            gate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { gatedCall.second.await() } }
            awaitCondition(testScheduler, 4_000) { refreshingJob.isCompleted }
            assertFalse(refreshingJob.isActive, "The stale action completed only after its milestone released")
            val kept = assertNotNull(harness.vault.read(), "B's credentials must survive the stale failure")
            assertEquals(saved, kept, "The whole SavedAuth snapshot is unchanged")
            testScheduler.runCurrent()
            assertTrue(harness.repository.state.value.authenticated, "A stale ordinary-action failure must not expire the newer session")
            assertEquals("owner-user-2", harness.repository.state.value.owner)
            assertEquals("syn-b@example.invalid", harness.account.state.value.email)
            harness.repository.stop()
        } finally {
            gate.complete(Unit)
            refreshing?.let { job ->
                job.cancel()
                runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { job.join() } } }
            }
            fake.http.stop()
            dir.deleteRecursively()
        }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun failedActivationYieldsNotReadyAndNeverOpensLearning() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
            val rules = assets().read("config/rules.arab.json").encodeToByteArray()
            val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
            val proofCatalog = Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256)))
            val delegate = InMemoryActiveProfileStore()
            val toggle = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
                var fail = false
                override val activeId = delegate.activeId
                override suspend fun setActive(id: String?) {
                    if (fail) throw java.io.IOException("Synthetic active-store failure")
                    delegate.setActive(id)
                }
            }
            val harness = Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), FakeApi(fake, proofCatalog), softwareAead(), activeStore = toggle)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.repository.create()
            val aProfile = assertNotNull(delegate.activeId.first())
            // B signs in and selects a learner, but B's native activation now fails: A must be retained.
            toggle.fail = true
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            harness.repository.create()
            assertEquals(aProfile, delegate.activeId.first(), "A stays active when B's activation fails")
            assertEquals(LearningReadiness.NOT_READY, harness.repository.prepareLearning())
            val vm = SyncLabViewModel(harness.repository, harness.account)
            val readiness = java.util.concurrent.atomic.AtomicReference<LearningReadiness?>(null)
            vm.learn { readiness.set(it) }
            testScheduler.runCurrent()
            awaitCondition(testScheduler, 4_000) { readiness.get() != null }
            assertEquals(LearningReadiness.NOT_READY, readiness.get(), "The ViewModel must report NOT_READY, never consent-granted")
            var navigated = false
            when (readiness.get()!!) {
                LearningReadiness.READY, LearningReadiness.CONSENT_NEEDED -> navigated = true
                LearningReadiness.NOT_READY -> Unit
            }
            assertFalse(navigated, "NOT_READY must never navigate into native learning under a previous profile")
            assertEquals(aProfile, delegate.activeId.first())
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun staleFailureCannotExpireReinstalledSameOwnerSession() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val fake = FakeGoTrue()
            val api = FakeApi(fake)
            val dir = File.createTempFile("account", "").apply { delete() }
            val gate = CompletableDeferred<Unit>()
            var refreshing: kotlinx.coroutines.Job? = null
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                val harness = newHarness(dir, fake, api)
                val vm = SyncLabViewModel(harness.repository, harness.account)
                testScheduler.runCurrent() // drain the empty-vault restore before any account exists
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                // Drain the initial sign-in's exact entry/exit pair.
                val initial = withContext(Dispatchers.Default) { api.learnersPairs.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
                assertNotNull(initial, "The sign-in's learner load must register its entry/exit pair")
                initial!!.first.await()
                initial.second.await()
                // A1's "Load this account's learners" begins and parks at a fresh per-request call.
                api.learnersGate = gate
                val refreshingJob = vm.refresh().also { refreshing = it }
                testScheduler.runCurrent()
                val gatedCall = withContext(Dispatchers.Default) { api.learnersPairs.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
                assertNotNull(gatedCall, "The later request must register its own entry/exit pair")
                gatedCall!!.first.await() // entered completes only after the call captured its gate
                assertFalse(refreshingJob.isCompleted, "The action stays pending while its learners milestone is held")
                // Same owner re-authenticates through logout + a fresh sign-in (A2) while A1's
                // request is still suspended: owner and authenticated state are identical, so the
                // origin must be the opaque session mark, not (owner, authenticated).
                // Clear the field first so A2's own learner load passes; the parked call keeps its
                // captured gate and is released afterwards with a 401.
                harness.account.signOut()
                api.learnersGate = null
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                assertTrue(harness.repository.state.value.authenticated)
                assertEquals("owner-user-1", harness.repository.state.value.owner)
                val saved = assertNotNull(harness.vault.read(), "A2's session is persisted")
                api.failLearnersWith401 = true
                gate.complete(Unit)
                withContext(Dispatchers.Default) { withTimeout(4_000) { gatedCall.second.await() } }
                awaitCondition(testScheduler, 4_000) { refreshingJob.isCompleted }
                assertFalse(refreshingJob.isActive, "The stale action completed only after its milestone released")
                val kept = assertNotNull(harness.vault.read(), "A2's credentials must survive A1's stale failure")
                assertEquals(saved, kept, "The whole SavedAuth snapshot is unchanged")
                testScheduler.runCurrent()
                assertTrue(harness.repository.state.value.authenticated, "A1's stale failure must not expire the reinstalled A2 session")
                assertEquals("owner-user-1", harness.repository.state.value.owner)
                assertEquals("syn-a@example.invalid", harness.account.state.value.email)
                harness.repository.stop()
            } finally {
                gate.complete(Unit)
                refreshing?.let { job ->
                    job.cancel()
                    runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { job.join() } } }
                }
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun signInLearnerLoadFailureKeepsInstalledAuthenticatedSession() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            api.failLearnersWith503 = true
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"), "A transient learner-load failure must not fail the sign-in")
            assertTrue(harness.repository.state.value.authenticated, "The committed session stays installed")
            assertNotNull(harness.vault.read(), "The session must be persisted, not left behind a false result")
            assertEquals("owner-user-1", harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.learners.isEmpty())
            assertEquals(R.string.sync_lab_failed, harness.repository.state.value.notice)
            api.failLearnersWith503 = false
            harness.repository.refresh()
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice, "The learner load recovers on retry")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun refreshRejectsProviderSubjectChangeAndOwnerMismatch() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-c@example.invalid", "password-three")
            val harness = newHarness(dir, fake)
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.vault.write(harness.vault.read()!!.copy(expiresAtMs = 0))
            fake.expiredAccess += harness.vault.read()!!.session.accessToken
            fake.refreshAsOtherUser = true
            assertFalse(harness.account.refreshSession(), "A rotated session for a different subject must be rejected")
            assertNull(harness.vault.read(), "Rejected rotation must clear the stale session")
            assertFalse(harness.repository.state.value.authenticated)
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun logoutDuringLoginLearnerLoadCannotActivateOldProfile() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val gate = CompletableDeferred<Unit>()
        api.learnersGate = gate
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val signingIn = async { harness.account.signIn("syn-a@example.invalid", "password-one") }
            api.learnersEntered.await()
            harness.account.signOut()
            gate.complete(Unit)
            assertFalse(signingIn.await())
            assertNull(harness.repository.state.value.owner)
            assertNull(harness.active.activeId.first(), "A stale login continuation must not activate or observe a profile")
            harness.repository.stop()
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun realGoTrueSignupConfirmLoginRefreshLogoutAndOwnerIsolation() = runBlocking {
        val fixture = System.getenv("UMAR_E2E_FIXTURES")
        assumeTrue("Run integration/run-android-e2e.sh for real local services", !fixture.isNullOrBlank())
        val tokens = Json.parseToJsonElement(File(fixture!!).readText()).jsonObject
        val accounts = tokens.getValue("accounts").jsonObject
        val api = HttpBackend(tokens.getValue("api").jsonPrimitive.content)
        val auth = GoTrueAuth("http://127.0.0.1:8287")
        val dir = File.createTempFile("account-real", "").apply { delete() }
        val aead = softwareAead()
        val harness = Harness(dir, auth, api, aead)
        try {
            // 1. Real signup + local Mailpit confirmation through the account controller.
            val suffix = java.util.UUID.randomUUID().toString().take(8)
            val email = "syn-android-$suffix@example.invalid"
            val password = "synthetic-password-$suffix"
            assertTrue(harness.account.signUp(email, password))
            val code = mailCode(email, "signup")
            assertTrue(harness.account.confirm(email, code))
            assertTrue(harness.repository.state.value.authenticated)
            // 2. Fixture account A: password sign-in matches the API's durable owner; A creates a learner.
            val a = accounts.getValue("A").jsonObject
            val emailA = a.getValue("email").jsonPrimitive.content
            val passwordA = a.getValue("password").jsonPrimitive.content
            val tokenA = tokens.getValue("A").jsonPrimitive.content
            harness.account.signOut()
            assertTrue(harness.account.signIn(emailA, passwordA))
            assertEquals(api.currentAccount(tokenA), harness.repository.state.value.owner)
            harness.repository.create()
            val aLearner = assertNotNull(harness.repository.state.value.selected)
            // 3. An actually-expired fixture token must refresh through the real provider and resume the same owner.
            val saved = harness.vault.read()!!
            harness.vault.write(
                SavedAuth(
                    AuthSession(
                        accessToken = tokens.getValue("expired").jsonPrimitive.content,
                        refreshToken = tokens.getValue("expired_refresh").jsonPrimitive.content,
                        expiresIn = 60, tokenType = "bearer",
                        user = AuthUser(id = saved.session.user.id, email = emailA),
                    ),
                    expiresAtMs = 0, savedAtMs = 0,
                ),
            )
            val relaunched = Harness(dir, auth, api, aead)
            try {
                assertTrue(relaunched.account.restore())
                assertEquals(api.currentAccount(tokenA), relaunched.repository.state.value.owner)
                assertTrue(relaunched.repository.state.value.authenticated)
                // 4. Logout clears local state; a freshly fabricated owner gets an empty namespace
                //    and cannot read A's record — independent of any other test's fixture usage.
                relaunched.account.signOut()
                assertNull(relaunched.vault.read())
                assertNull(relaunched.repository.state.value.owner)
                val cEmail = "syn-android-c-$suffix@example.invalid"
                val cPassword = "synthetic-password-c-$suffix"
                assertTrue(relaunched.account.signUp(cEmail, cPassword))
                assertTrue(relaunched.account.confirm(cEmail, mailCode(cEmail, "signup")))
                assertNotEquals(api.currentAccount(tokenA), relaunched.repository.state.value.owner)
                assertTrue(relaunched.repository.state.value.learners.isEmpty(), "A fresh fabricated owner must start with no learners")
                assertFailsWith<IllegalArgumentException> { relaunched.repository.select(aLearner) }
                val cAccess = relaunched.vault.read()!!.session.accessToken
                val denied = assertFailsWith<ApiFailure> { api.pull(cAccess, aLearner.id, 0) }
                assertEquals(404, denied.status)
            } finally {
                relaunched.repository.stop()
            }
            println("REAL_ANDROID_ACCOUNT_E2E_PASS: real GoTrue signup; local Mailpit confirmation; password login; actual expired token refresh/rotation; logout; fresh-owner isolation (empty namespace, select rejected, direct read 404)")
        } finally {
            harness.repository.stop()
            dir.deleteRecursively()
        }
    }

    private fun mailCode(email: String, kind: String): String {
        fun get(path: String): String {
            val connection = java.net.URI.create("http://127.0.0.1:8387$path").toURL()
                .openConnection(java.net.Proxy.NO_PROXY) as java.net.HttpURLConnection
            try {
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.setRequestProperty("Accept", "application/json")
                val status = connection.responseCode
                val body = connection.inputStream.use { it.readBytes() }.decodeToString()
                assertEquals(200, status)
                return body
            } finally {
                connection.disconnect()
            }
        }
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(30)
        while (System.nanoTime() < deadline) {
            val search = Json.parseToJsonElement(get("/api/v1/search?query=" + URLEncoder.encode("to:$email", "UTF-8"))).jsonObject
            for (message in search.getValue("messages").jsonArray) {
                val summary = message.jsonObject
                val subject = summary.getValue("Subject").jsonPrimitive.content.lowercase()
                if (kind == "signup" && "confirm" !in subject) continue
                if (kind == "recovery" && "reset" !in subject && "recover" !in subject) continue
                val full = Json.parseToJsonElement(get("/api/v1/message/" + summary.getValue("ID").jsonPrimitive.content)).jsonObject
                val match = Regex("<strong>\\s*([0-9]{6})\\s*</strong>").find(full.getValue("HTML").jsonPrimitive.content)
                if (match != null) return match.groupValues[1]
            }
            Thread.sleep(250)
        }
        fail("Expected local synthetic confirmation/recovery email for $email")
    }

    /** FakeApi whose catalog satisfies PackProof.verify, so repository.create()/select() succeed. */
    private fun proofApi(fake: FakeGoTrue): FakeApi {
        val pack = assets().read("packs/bahasa/arab/v1.json").encodeToByteArray()
        val rules = assets().read("config/rules.arab.json").encodeToByteArray()
        val proof = PackProof.fromBytes(pack, rules, TEST_SOURCE_COMMIT)
        return FakeApi(fake, Catalog(proof.sourceCommit, listOf(CatalogPack(proof.track, proof.contentVersion, proof.rulesVersion, proof.packSha256, proof.rulesSha256))))
    }

    @Test fun learningReadinessRejectsOwnerChangeDuringConsentRead() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("learning-readiness", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val harness = newHarness(dir, fake, api = proofApi(fake))
            try {
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                harness.repository.create()
                val a1 = assertNotNull(harness.active.activeId.first())

                val consentEntered = CompletableDeferred<Unit>()
                val consentGate = CompletableDeferred<Unit>()
                harness.repository.learningConsentProbe = {
                    consentEntered.complete(Unit)
                    consentGate.await()
                }

                // An unbound B supersedes A after the local activation but before the consent read
                // completes; the stale readiness must fail closed and must not leave A's profile
                // active under B.
                val parked = async(Dispatchers.Default) { harness.repository.prepareLearning() }
                withContext(Dispatchers.Default) { withTimeout(10_000) { consentEntered.await() } }
                assertEquals(a1, harness.active.activeId.first(), "stale activation completed before the park")
                assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
                consentGate.complete(Unit)
                assertEquals(
                    LearningReadiness.NOT_READY,
                    withContext(Dispatchers.Default) { withTimeout(10_000) { parked.await() } },
                    "stale readiness must fail closed after an owner change",
                )
                assertNull(harness.active.activeId.first(), "the stale activation must not leave A active under B")
                assertNotNull(harness.db.profiles().get(a1), "the readiness fence never deletes the local profile row")
            } finally {
                harness.repository.stop()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun learningReadinessRetainsNewerSameOwnerSelection() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("learning-readiness-same-owner", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api = proofApi(fake))
            try {
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                harness.repository.create()
                val a1 = assertNotNull(harness.active.activeId.first())

                val consentEntered = CompletableDeferred<Unit>()
                val consentGate = CompletableDeferred<Unit>()
                harness.repository.learningConsentProbe = {
                    consentEntered.complete(Unit)
                    consentGate.await()
                }

                // The same owner selects A2 while the consent read is parked; the stale readiness
                // must fail closed, the newer selection must be retained, and A2 keeps its local
                // profile/credentials.
                val parked = async(Dispatchers.Default) { harness.repository.prepareLearning() }
                withContext(Dispatchers.Default) { withTimeout(10_000) { consentEntered.await() } }
                harness.repository.create()
                val a2 = assertNotNull(harness.active.activeId.first())
                assertNotEquals(a1, a2)
                consentGate.complete(Unit)
                assertEquals(
                    LearningReadiness.NOT_READY,
                    withContext(Dispatchers.Default) { withTimeout(10_000) { parked.await() } },
                    "a superseded learner selection must fail closed",
                )
                assertEquals(a2, harness.active.activeId.first(), "a newer same-owner selection must be retained")
                assertNull(
                    assertNotNull(harness.db.profiles().get(a2), "A2 keeps its local profile/credentials").consentVersion,
                )
                assertNotNull(harness.db.profiles().get(a1))
            } finally {
                harness.repository.stop()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun learningCallbackRejectsOwnerChangeBeforeMainDispatch() = runTest {
        val mainScheduler = TestCoroutineScheduler()
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(mainScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("learning-callback", "").apply { delete() }
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                fake.fabricate("syn-b@example.invalid", "password-two")
                val harness = newHarness(dir, fake, api = proofApi(fake))
                try {
                    val vm = SyncLabViewModel(harness.repository, harness.account)
                    mainScheduler.runCurrent() // empty-vault initial restore completes before any account exists
                    assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                    harness.repository.create()
                    val a1 = assertNotNull(harness.active.activeId.first())
                    // Grant consent so the stale readiness would be a success (READY) navigation.
                    harness.db.profiles().setConsent(a1, id.petalytix.ayailmu.feature.consent.Consent.VERSION, harness.clock.now().toEpochMilli())

                    val fenced = CompletableDeferred<Unit>()
                    harness.repository.learningResultProbe = { fenced.complete(Unit) }
                    val held = CompletableDeferred<Unit>()
                    val holdGate = CompletableDeferred<Unit>()
                    vm.learnDispatchProbe = { held.complete(Unit); holdGate.await() }
                    val calls = java.util.concurrent.CopyOnWriteArrayList<LearningReadiness>()
                    val job = vm.learn { calls.add(it) }
                    mainScheduler.runCurrent() // start the action; it suspends in prepareLearning on real IO
                    withContext(Dispatchers.Default) { withTimeout(10_000) { fenced.await() } } // readiness fenced on IO
                    // Drive Main until the exact continuation is dispatched and holds before the callback.
                    awaitCondition(mainScheduler, 10_000) { held.isCompleted }
                    assertTrue(calls.isEmpty(), "callback is still held on Main before dispatch")
                    assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
                    holdGate.complete(Unit)
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { job.join() } }
                    assertTrue(calls.isEmpty(), "a superseded owner must never receive the stale callback")
                    assertEquals(LearningReadiness.NOT_READY, harness.repository.prepareLearning())
                } finally {
                    harness.repository.stop()
                }
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun learningCallbackRejectsSameOwnerSessionReplacement() = runTest {
        val mainScheduler = TestCoroutineScheduler()
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(mainScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("learning-callback-same-owner", "").apply { delete() }
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                val harness = newHarness(dir, fake, api = proofApi(fake))
                try {
                    val vm = SyncLabViewModel(harness.repository, harness.account)
                    mainScheduler.runCurrent() // empty-vault initial restore completes before any account exists
                    assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                    harness.repository.create()
                    val a1 = assertNotNull(harness.active.activeId.first())
                    harness.db.profiles().setConsent(a1, id.petalytix.ayailmu.feature.consent.Consent.VERSION, harness.clock.now().toEpochMilli())

                    val fenced = CompletableDeferred<Unit>()
                    harness.repository.learningResultProbe = { fenced.complete(Unit) }
                    val held = CompletableDeferred<Unit>()
                    val holdGate = CompletableDeferred<Unit>()
                    vm.learnDispatchProbe = { held.complete(Unit); holdGate.await() }
                    val calls = java.util.concurrent.CopyOnWriteArrayList<LearningReadiness>()
                    val job = vm.learn { calls.add(it) }
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { fenced.await() } }
                    awaitCondition(mainScheduler, 10_000) { held.isCompleted }
                    assertTrue(calls.isEmpty(), "callback is still held on Main before dispatch")
                    // Same-owner credential/session replacement supersedes the session attempt.
                    assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                    holdGate.complete(Unit)
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { job.join() } }
                    assertTrue(calls.isEmpty(), "a superseded session attempt must never receive the stale callback")
                    // The newer vault and A's profile/consent survive the superseded callback.
                    val saved = assertNotNull(harness.vault.read(), "the newer same-owner vault survives")
                    assertEquals(
                        harness.repository.state.first().owner,
                        FakeApi(fake).currentAccount(saved.session.accessToken),
                        "the newer vault stays valid for the same owner",
                    )
                    assertEquals(
                        id.petalytix.ayailmu.feature.consent.Consent.VERSION,
                        assertNotNull(harness.db.profiles().get(a1)).consentVersion,
                    )
                } finally {
                    harness.repository.stop()
                }
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun learningReadinessRetainsNewerActivationAfterSameOwnerRelogin() = runTest {
        val fake = FakeGoTrue()
        val dir = File.createTempFile("learning-readiness-relogin", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api = proofApi(fake))
            try {
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                harness.repository.create()
                val a1 = assertNotNull(harness.active.activeId.first())
                harness.db.profiles().setConsent(a1, id.petalytix.ayailmu.feature.consent.Consent.VERSION, harness.clock.now().toEpochMilli())

                val consentEntered = CompletableDeferred<Unit>()
                val consentGate = CompletableDeferred<Unit>()
                harness.repository.learningConsentProbe = {
                    consentEntered.complete(Unit)
                    consentGate.await()
                }

                // A same-owner re-login supersedes the session attempt but re-activates the SAME
                // learner; the old readiness must fail closed while the newer activation and the
                // newer vault survive.
                val parked = async(Dispatchers.Default) { harness.repository.prepareLearning() }
                withContext(Dispatchers.Default) { withTimeout(10_000) { consentEntered.await() } }
                assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                assertEquals(a1, harness.active.activeId.first(), "the re-login re-activated the same profile")
                val vaultSnapshot = harness.vault.read()
                consentGate.complete(Unit)
                assertEquals(
                    LearningReadiness.NOT_READY,
                    withContext(Dispatchers.Default) { withTimeout(10_000) { parked.await() } },
                    "the superseded session attempt must fail closed",
                )
                assertEquals(a1, harness.active.activeId.first(), "the newer activation of the same profile survives")
                val survived = harness.vault.read()
                assertEquals(vaultSnapshot?.session?.accessToken, survived?.session?.accessToken, "the newer vault snapshot survives")
                assertEquals(vaultSnapshot?.session?.refreshToken, survived?.session?.refreshToken)
                assertEquals(vaultSnapshot?.expiresAtMs, survived?.expiresAtMs)
            } finally {
                harness.repository.stop()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun learningCallbackRejectsOfflineKnownLearnerSwitch() = runTest {
        val mainScheduler = TestCoroutineScheduler()
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(mainScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("learning-callback-offline", "").apply { delete() }
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                val harness = newHarness(dir, fake, api = proofApi(fake))
                try {
                    val vm = SyncLabViewModel(harness.repository, harness.account)
                    mainScheduler.runCurrent() // empty-vault initial restore completes before any account exists
                    assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                    harness.repository.create()
                    val learnerA1 = assertNotNull(harness.repository.state.first().selected)
                    val a1 = learnerA1.clientLearnerId
                    harness.repository.create()
                    val learnerA2 = assertNotNull(harness.repository.state.first().selected)
                    val a2 = learnerA2.clientLearnerId
                    harness.repository.select(learnerA1)
                    assertEquals(a1, harness.active.activeId.first())
                    harness.db.profiles().setConsent(a1, id.petalytix.ayailmu.feature.consent.Consent.VERSION, harness.clock.now().toEpochMilli())
                    // Expire the in-memory session: durable owner/binding and offline learner
                    // switching stay available, but selectKnown does not advance the session mark.
                    harness.repository.expireSession()

                    val fenced = CompletableDeferred<Unit>()
                    harness.repository.learningResultProbe = { fenced.complete(Unit) }
                    val held = CompletableDeferred<Unit>()
                    val holdGate = CompletableDeferred<Unit>()
                    vm.learnDispatchProbe = { held.complete(Unit); holdGate.await() }
                    val calls = java.util.concurrent.CopyOnWriteArrayList<LearningReadiness>()
                    val job = vm.learn { calls.add(it) }
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { fenced.await() } }
                    awaitCondition(mainScheduler, 10_000) { held.isCompleted }
                    assertTrue(calls.isEmpty(), "callback is still held on Main before dispatch")
                    harness.repository.select(learnerA2)
                    holdGate.complete(Unit)
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { job.join() } }
                    assertTrue(calls.isEmpty(), "an offline known-learner switch must suppress the stale callback")
                    assertEquals(a2, harness.active.activeId.first(), "the newer offline selection is retained")

                    // Unchanged offline learning still reports READY exactly once.
                    harness.repository.select(learnerA1)
                    val offlineCalls = java.util.concurrent.CopyOnWriteArrayList<LearningReadiness>()
                    val offlineJob = vm.learn { offlineCalls.add(it) }
                    mainScheduler.runCurrent()
                    awaitCondition(mainScheduler, 10_000) { offlineCalls.isNotEmpty() }
                    mainScheduler.runCurrent()
                    withContext(Dispatchers.Default) { withTimeout(10_000) { offlineJob.join() } }
                    assertEquals(listOf(LearningReadiness.READY), offlineCalls, "unchanged offline learning reports READY")
                    assertEquals(a1, harness.active.activeId.first())
                } finally {
                    harness.repository.stop()
                }
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun learningReadinessPositiveControls() = runTest {
        Dispatchers.setMain(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler))
        try {
            val fake = FakeGoTrue()
            val dir = File.createTempFile("learning-positive", "").apply { delete() }
            try {
                fake.fabricate("syn-a@example.invalid", "password-one")
                val harness = newHarness(dir, fake, api = proofApi(fake))
                try {
                    val vm = SyncLabViewModel(harness.repository, harness.account)
                    testScheduler.runCurrent() // empty-vault initial restore completes before any account exists
                    assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
                    harness.repository.create()
                    val a1 = assertNotNull(harness.active.activeId.first())
                    val delivered = java.util.concurrent.CopyOnWriteArrayList<LearningReadiness>()
                    val sessionNavigations = java.util.concurrent.atomic.AtomicInteger(0)
                    fun learnOnce() = vm.learn { readiness ->
                        delivered.add(readiness)
                        if (readiness == LearningReadiness.READY) sessionNavigations.incrementAndGet()
                    }

                    learnOnce()
                    testScheduler.runCurrent()
                    awaitCondition(testScheduler, 4_000) { delivered.size == 1 }
                    assertEquals(LearningReadiness.CONSENT_NEEDED, delivered[0], "consent-needed status stays accurate before consent")
                    assertEquals(0, sessionNavigations.get())

                    harness.db.profiles().setConsent(a1, id.petalytix.ayailmu.feature.consent.Consent.VERSION, harness.clock.now().toEpochMilli())
                    learnOnce()
                    testScheduler.runCurrent()
                    awaitCondition(testScheduler, 4_000) { delivered.size == 2 }
                    assertEquals(LearningReadiness.READY, delivered[1], "unchanged valid A reports READY")
                    assertEquals(1, sessionNavigations.get(), "valid A navigates exactly once")
                    assertEquals(a1, harness.active.activeId.first())
                } finally {
                    harness.repository.stop()
                }
            } finally {
                fake.http.stop()
                dir.deleteRecursively()
            }
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test fun cancelledSignInLeavesNoCommittedLiveAuth() = runTest {
        // The engine commit precedes the suspending learner load; cancelling the exact coroutine
        // while parked there must not leave live unpersisted auth, a durable owner, or busy set.
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                val gate = CompletableDeferred<Unit>()
                api.learnersGate = gate
                val signingIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }
                // The entered milestone means this exact learners() call already captured its gate,
                // so cancellation — never gate completion — is what releases the parked flow.
                val parked = withContext(Dispatchers.Default) {
                    withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
                }
                assertNotNull(parked, "The learners call must enter and capture its gate")
                parked!!.await()
                signingIn.cancel()
                withContext(Dispatchers.Default) { withTimeout(4_000) { signingIn.cancelAndJoin() } }
                assertFalse(harness.account.state.value.busy, "Cancellation cleanup must clear busy")
                assertFalse(harness.repository.state.value.authenticated, "A cancelled install must leave no live unpersisted auth")
                assertNull(harness.vault.read(), "A cancelled install must never install credentials")
                assertNull(harness.repository.savedOwner(), "The cancelled attempt must drop its durable owner")
                assertNull(harness.repository.state.value.owner)
                assertNull(harness.repository.state.value.selected)
                assertNull(harness.active.activeId.first())
            } finally {
                runCatching { harness.repository.stop() }
                ioScope.cancel()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun cancelledConfirmationLeavesNoCommittedLiveAuth() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                assertTrue(harness.account.signUp("syn-a@example.invalid", "password-one"))
                val gate = CompletableDeferred<Unit>()
                api.learnersGate = gate
                val confirming = ioScope.async { harness.account.confirm("syn-a@example.invalid", "111111") }
                val parked = withContext(Dispatchers.Default) {
                    withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
                }
                assertNotNull(parked, "The learners call must enter and capture its gate")
                parked!!.await()
                confirming.cancel()
                withContext(Dispatchers.Default) { withTimeout(4_000) { confirming.cancelAndJoin() } }
                assertFalse(harness.account.state.value.busy, "Cancellation cleanup must clear busy")
                assertFalse(harness.repository.state.value.authenticated, "A cancelled confirmation must leave no live unpersisted auth")
                assertNull(harness.vault.read(), "A cancelled confirmation must never install credentials")
                assertNull(harness.repository.savedOwner(), "The cancelled attempt must drop its durable owner")
                assertNull(harness.repository.state.value.owner)
                assertNull(harness.repository.state.value.selected)
                assertNull(harness.active.activeId.first())
            } finally {
                runCatching { harness.repository.stop() }
                ioScope.cancel()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun cancelledGoogleFlowLeavesNoCommittedLiveAuth() = runTest {
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val harness = newHarness(dir, fake, api)
            val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
                val state = harness.account.googleState()!!
                val gate = CompletableDeferred<Unit>()
                api.learnersGate = gate
                val completing = ioScope.async { harness.account.completeGoogle(state, "auth-code") }
                val parked = withContext(Dispatchers.Default) {
                    withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
                }
                assertNotNull(parked, "The learners call must enter and capture its gate")
                parked!!.await()
                completing.cancel()
                withContext(Dispatchers.Default) { withTimeout(4_000) { completing.cancelAndJoin() } }
                assertFalse(harness.account.state.value.busy, "Cancellation cleanup must clear busy")
                assertFalse(harness.repository.state.value.authenticated, "A cancelled Google flow must leave no live unpersisted auth")
                assertNull(harness.vault.read(), "A cancelled Google flow must never install credentials")
                assertNull(harness.repository.savedOwner(), "The cancelled attempt must drop its durable owner")
                assertNull(harness.repository.state.value.owner)
                assertNull(harness.repository.state.value.selected)
                assertNull(harness.active.activeId.first())
            } finally {
                runCatching { harness.repository.stop() }
                ioScope.cancel()
            }
        } finally {
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun heldCancelledCleanupPreservesNewerBoundAccount() = runTest {
        // A1's cancelled cleanup is held at the revert probe before the local ordering boundary.
        // B then fully signs in and selects a profile: profile creation does need that boundary,
        // but it is free because the probe holds the cleanup before the boundary is acquired.
        val fake = FakeGoTrue()
        val api = proofApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        val harness = newHarness(dir, fake, api)
        val revertGate = CompletableDeferred<Unit>()
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var owned: Deferred<Boolean>? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val revertEntered = CompletableDeferred<Unit>()
            harness.repository.revertProbe = {
                revertEntered.complete(Unit)
                revertGate.await()
            }
            val gate = CompletableDeferred<Unit>()
            api.learnersGate = gate
            val signingIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }.also { owned = it }
            val parked = withContext(Dispatchers.Default) {
                withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parked, "A1's learners call must enter and capture its gate")
            parked!!.await()
            api.learnersGate = null
            signingIn.cancel()
            withContext(Dispatchers.Default) { withTimeout(4_000) { revertEntered.await() } }
            // While A1's cleanup is held before its mutations, B completes bound, with a profile.
            assertTrue(harness.account.signIn("syn-b@example.invalid", "password-two"))
            harness.repository.create()
            val saved = assertNotNull(harness.vault.read(), "B's session is persisted")
            val owner = harness.repository.state.value.owner
            val selected = harness.repository.state.value.selected
            val activeProfile = harness.active.activeId.first()
            val email = harness.account.state.value.email
            assertNotNull(selected)
            assertNotNull(activeProfile)
            revertGate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { signingIn.cancelAndJoin() } }
            val kept = assertNotNull(harness.vault.read(), "B's credentials must survive the old cleanup")
            assertEquals(saved, kept, "The whole newer SavedAuth snapshot is unchanged")
            assertEquals(owner, harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated, "B's live session is preserved")
            assertEquals(selected!!.id, harness.repository.state.value.selected!!.id)
            assertEquals(activeProfile, harness.active.activeId.first())
            assertEquals(email, harness.account.state.value.email)
            harness.repository.refresh()
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice, "The preserved session stays usable")
        } finally {
            revertGate.complete(Unit)
            owned?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            runCatching { harness.repository.stop() }
            ioScope.cancel()
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun heldCancelledCleanupPreservesSameOwnerReplacement() = runTest {
        // Same schedule with a same-owner replacement: A2 re-signs the exact account A1 attempted,
        // so the durable owner string never changes (A2's begin also moves the account nonce). The
        // receipt recorded at A1's engine commit is the backstop that identifies A1's own effects.
        val fake = FakeGoTrue()
        val api = proofApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        val harness = newHarness(dir, fake, api)
        val revertGate = CompletableDeferred<Unit>()
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var owned: Deferred<Boolean>? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            val revertEntered = CompletableDeferred<Unit>()
            harness.repository.revertProbe = {
                revertEntered.complete(Unit)
                revertGate.await()
            }
            val gate = CompletableDeferred<Unit>()
            api.learnersGate = gate
            val signingIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }.also { owned = it }
            val parked = withContext(Dispatchers.Default) {
                withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parked, "A1's learners call must enter and capture its gate")
            parked!!.await()
            api.learnersGate = null
            signingIn.cancel()
            withContext(Dispatchers.Default) { withTimeout(4_000) { revertEntered.await() } }
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"), "The same-owner replacement succeeds")
            harness.repository.create()
            val saved = assertNotNull(harness.vault.read(), "A2's session is persisted")
            val owner = harness.repository.state.value.owner
            val selected = harness.repository.state.value.selected
            val activeProfile = harness.active.activeId.first()
            val email = harness.account.state.value.email
            assertNotNull(selected)
            assertNotNull(activeProfile)
            revertGate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { signingIn.cancelAndJoin() } }
            val kept = assertNotNull(harness.vault.read(), "A2's credentials must survive A1's old cleanup")
            assertEquals(saved, kept, "The whole replacement SavedAuth snapshot is unchanged")
            assertEquals(owner, harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated, "The replacement session stays live")
            assertEquals(selected!!.id, harness.repository.state.value.selected!!.id)
            assertEquals(activeProfile, harness.active.activeId.first())
            assertEquals(email, harness.account.state.value.email)
            harness.repository.refresh()
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice, "The replacement session stays usable")
        } finally {
            revertGate.complete(Unit)
            owned?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            runCatching { harness.repository.stop() }
            ioScope.cancel()
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun heldCancelledCleanupPreservesRefreshedSessionAtEqualAccountNonce() = runTest {
        // A0 is genuinely installed; A1's re-sign-in of the same account is cancelled and its cleanup
        // is held; a same-owner refresh then rotates and installs newer credentials without any
        // account operation beginning — the account nonce stays equal, so only the engine receipt
        // recorded at A1's commit can keep the old cleanup off the refreshed session.
        val fake = FakeGoTrue()
        val api = proofApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        val harness = newHarness(dir, fake, api)
        val revertGate = CompletableDeferred<Unit>()
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var owned: Deferred<Boolean>? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            harness.repository.create()
            val a0 = assertNotNull(harness.vault.read())
            val revertEntered = CompletableDeferred<Unit>()
            harness.repository.revertProbe = {
                revertEntered.complete(Unit)
                revertGate.await()
            }
            // Drain every completed setup learners registration (A0's sign-in, select and create)
            // before launching A1's gated flow, so A1's fresh parked call is the awaited milestone.
            while (true) {
                val drained = withContext(Dispatchers.Default) {
                    api.learnersCalls.poll(200, java.util.concurrent.TimeUnit.MILLISECONDS)
                } ?: break
                drained.await()
            }
            val gate = CompletableDeferred<Unit>()
            api.learnersGate = gate
            val signingIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }.also { owned = it }
            val parked = withContext(Dispatchers.Default) {
                withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parked, "A1's learners call must enter and capture its gate")
            parked!!.await()
            api.learnersGate = null
            signingIn.cancel()
            withContext(Dispatchers.Default) { withTimeout(4_000) { revertEntered.await() } }
            fake.expiredAccess += a0.session.accessToken
            assertTrue(harness.account.refreshSession(), "The same-owner refresh rotates and installs newer credentials")
            val saved = assertNotNull(harness.vault.read(), "The rotated session is persisted")
            assertNotEquals(a0, saved, "The refresh installed newer credentials")
            val owner = harness.repository.state.value.owner
            val selected = harness.repository.state.value.selected
            val activeProfile = harness.active.activeId.first()
            val email = harness.account.state.value.email
            revertGate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { signingIn.cancelAndJoin() } }
            val kept = assertNotNull(harness.vault.read(), "The rotated credentials must survive the old cleanup")
            assertEquals(saved, kept, "The whole refreshed SavedAuth snapshot is unchanged")
            assertEquals(owner, harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated, "The refreshed session stays live")
            assertEquals(selected!!.id, harness.repository.state.value.selected!!.id)
            assertEquals(activeProfile, harness.active.activeId.first())
            assertEquals(email, harness.account.state.value.email)
            harness.repository.refresh()
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice, "The refreshed session stays usable")
        } finally {
            revertGate.complete(Unit)
            owned?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            runCatching { harness.repository.stop() }
            ioScope.cancel()
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun cancelledCleanupHeldInActiveStoreClearPreservesUnboundNewerAccount() = runTest {
        // The cancelled cleanup parks inside the gated active-store clear under NonCancellable and
        // stays pending until the clear is released; the newer account is unbound (a nonempty remote
        // learner list, no local binding), so it finishes without the held local ordering boundary.
        val fake = FakeGoTrue()
        val raw = FakeApi(fake)
        val learnerTokens = java.util.concurrent.CopyOnWriteArrayList<String>()
        val api = object : Backend by raw {
            override suspend fun learners(token: String): List<Learner> {
                learnerTokens.add(token)
                return raw.learners(token)
            }
        }
        val dir = File.createTempFile("account", "").apply { delete() }
        val storeEntered = CompletableDeferred<Unit>()
        val storeGate = CompletableDeferred<Unit>()
        val delegate = InMemoryActiveProfileStore()
        val gatedStore = object : id.petalytix.ayailmu.core.data.settings.ActiveProfileStore {
            override val activeId = delegate.activeId
            override suspend fun setActive(id: String?) {
                if (id == null) { storeEntered.complete(Unit); storeGate.await() }
                delegate.setActive(id)
            }
        }
        val harness = Harness(dir, GoTrueAuth("http://127.0.0.1:${fake.http.port}"), api, softwareAead(), activeStore = gatedStore)
        val gateB = CompletableDeferred<Unit>()
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var ownedOld: Deferred<Boolean>? = null
        var ownedB: Deferred<Boolean>? = null
        try {
            fake.fabricate("syn-a@example.invalid", "password-one")
            fake.fabricate("syn-b@example.invalid", "password-two")
            val gateA = CompletableDeferred<Unit>()
            raw.learnersGate = gateA
            val signingIn = ioScope.async { harness.account.signIn("syn-a@example.invalid", "password-one") }.also { ownedOld = it }
            val parkedA = withContext(Dispatchers.Default) {
                withTimeout(4_000) { raw.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parkedA, "A1's learners call must enter and capture its gate")
            parkedA!!.await()
            signingIn.cancel()
            withContext(Dispatchers.Default) { withTimeout(4_000) { storeEntered.await() } }
            assertFalse(signingIn.isCompleted, "The old job must stay pending while its cleanup is held in the store clear")
            // Unbound newer account with a nonempty remote learner list; never needs localLock.
            raw.learnersGate = gateB
            val signingB = ioScope.async { harness.account.signIn("syn-b@example.invalid", "password-two") }.also { ownedB = it }
            val parkedB = withContext(Dispatchers.Default) {
                withTimeout(4_000) { raw.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parkedB, "B's learners call must enter and capture its gate")
            parkedB!!.await()
            val remoteB = Learner("remote-b1", "syn_b_remote_1", "ADULT", "adults", "id")
            raw.profiles[learnerTokens.last()] = mutableListOf(remoteB)
            gateB.complete(Unit)
            assertTrue(withContext(Dispatchers.Default) { withTimeout(4_000) { signingB.await() } })
            assertFalse(signingIn.isCompleted, "The old job is still pending until the store clear is released")
            val savedB = assertNotNull(harness.vault.read(), "B's session is persisted")
            val ownerB = harness.repository.state.value.owner
            assertEquals(listOf(remoteB), harness.repository.state.value.learners, "B's remote learner list is published")
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice)
            storeGate.complete(Unit)
            withContext(Dispatchers.Default) { withTimeout(4_000) { signingIn.cancelAndJoin() } }
            assertTrue(signingIn.isCompleted)
            val kept = assertNotNull(harness.vault.read(), "B's credentials must survive the old cleanup")
            assertEquals(savedB, kept, "The whole newer SavedAuth snapshot is unchanged")
            assertEquals(ownerB, harness.repository.state.value.owner)
            assertTrue(harness.repository.state.value.authenticated, "B's session stays live across the old store wait")
            assertEquals(listOf(remoteB), harness.repository.state.value.learners, "The newer remote learner list is never cleared")
            assertEquals(R.string.sync_lab_saved, harness.repository.state.value.notice, "No stale signed-out notice may publish over B")
            assertEquals("syn-b@example.invalid", harness.account.state.value.email)
            assertFalse(harness.account.state.value.busy)
        } finally {
            storeGate.complete(Unit)
            gateB.complete(Unit)
            ownedOld?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            ownedB?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            runCatching { harness.repository.stop() }
            ioScope.cancel()
            fake.http.stop()
            dir.deleteRecursively()
        }
    }

    @Test fun cancelGoogleDuringLearnerLoadPreservesGenuineVault() = runTest {
        // Genuine persisted credentials the Google attempt never installed must survive an intent
        // cancellation at the learner load, while the durable owner that attempt introduced is gone.
        // The valid synthetic provider session is issued and retained in the vault directly, so the
        // durable engine owner stays null and the credentials are never revoked.
        val fake = FakeGoTrue()
        val api = FakeApi(fake)
        val dir = File.createTempFile("account", "").apply { delete() }
        val harness = newHarness(dir, fake, api)
        val gate = CompletableDeferred<Unit>()
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var owned: Deferred<Boolean>? = null
        try {
            fake.fabricate("syn-g@example.invalid", "password-one")
            val provider = GoTrueAuth("http://127.0.0.1:${fake.http.port}")
            val session = provider.signIn("syn-g@example.invalid", "password-one")
            val now = harness.clock.now().toEpochMilli()
            harness.vault.write(SavedAuth(session, now + session.expiresIn * 1_000, now))
            val genuine = assertNotNull(harness.vault.read(), "A genuine session exists before the Google attempt")
            assertNull(harness.repository.savedOwner(), "Signed out: only the genuine vault material is present")
            harness.account.beginGoogle() ?: fail("beginGoogle must return a URL when signed out")
            val state = harness.account.googleState()!!
            api.learnersGate = gate
            val completing = ioScope.async { harness.account.completeGoogle(state, "auth-code") }.also { owned = it }
            val parked = withContext(Dispatchers.Default) {
                withTimeout(4_000) { api.learnersCalls.poll(4, java.util.concurrent.TimeUnit.SECONDS) }
            }
            assertNotNull(parked, "The learners call must enter and capture its gate")
            parked!!.await()
            assertNotNull(harness.repository.savedOwner(), "The Google attempt introduced a durable owner before the cancel")
            assertTrue(harness.repository.state.value.authenticated, "The Google attempt introduced live auth before the cancel")
            harness.account.cancelGoogle()
            gate.complete(Unit)
            assertFalse(withContext(Dispatchers.Default) { withTimeout(4_000) { completing.await() } }, "A flow cancelled during learner load must be discarded")
            assertNull(harness.repository.savedOwner(), "The cancelled attempt must leave no durable owner")
            assertNull(harness.repository.state.value.owner)
            assertFalse(harness.repository.state.value.authenticated, "The introduced live auth must be gone")
            assertFalse(harness.account.state.value.busy)
            val kept = assertNotNull(harness.vault.read(), "The genuine vault session must remain installed")
            assertEquals(genuine, kept, "The whole genuine SavedAuth snapshot is unchanged")
        } finally {
            gate.complete(Unit)
            owned?.let { runCatching { withContext(Dispatchers.Default) { withTimeout(4_000) { it.cancelAndJoin() } } } }
            runCatching { harness.repository.stop() }
            ioScope.cancel()
            fake.http.stop()
            dir.deleteRecursively()
        }
    }
}
