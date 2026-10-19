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
import id.petalytix.ayailmu.core.sync.GoTrueAuth
import id.petalytix.ayailmu.core.sync.HttpBackend
import id.petalytix.ayailmu.core.sync.Learner
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
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
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
    val refreshEntered = CompletableDeferred<Unit>()
    var refreshGate: java.util.concurrent.CountDownLatch? = null
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
                val email = field("email")
                users[email] = User("user-${++next}", email, field("password"), confirmed = false)
                signupCodes[email] = "111111"
                200 to "{}"
            }
            path == "/resend" -> { signupCodes[field("email")] = "111111"; 200 to "{}" }
            path == "/recover" -> { recoveryCodes[field("email")] = "222222"; 200 to "{}" }
            path == "/verify" -> {
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
                val user = users.values.find { it.id == refreshOwner[field("refresh_token")] }
                val other = if (refreshAsOtherUser) users.values.find { it.id != user?.id } else null
                val issued = other ?: user
                if (issued == null) 400 to """{"error_code":"invalid_grant"}""" else 200 to session(issued)
            }
            path == "/token" && "grant_type=pkce" in query -> {
                tokenCalls++
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
private class FakeApi(private val fake: FakeGoTrue) : Backend {
    val accountEntered = CompletableDeferred<Unit>()
    var accountGate: CompletableDeferred<Unit>? = null
    val learnersEntered = CompletableDeferred<Unit>()
    var learnersGate: CompletableDeferred<Unit>? = null
    private fun owner(token: String): String {
        if (token !in fake.accessOwner || token in fake.expiredAccess) throw ApiFailure(401, "unauthorized")
        return "owner-" + fake.accessOwner.getValue(token)
    }
    override suspend fun account(token: String): String {
        accountEntered.complete(Unit)
        accountGate?.await()
        return owner(token)
    }
    override suspend fun currentAccount(token: String): String = owner(token)
    override suspend fun learners(token: String): List<Learner> {
        learnersEntered.complete(Unit)
        learnersGate?.await()
        return emptyList()
    }
    override suspend fun createLearner(token: String, clientId: String): Learner {
        owner(token)
        return Learner("remote-$clientId", clientId, "ADULT", "adults", "id")
    }
    override suspend fun catalog(token: String): Catalog = Catalog(TEST_SOURCE_COMMIT, emptyList())
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
    private class Harness(dir: File, auth: GoTrueAuth, api: Backend, aead: Aead, val clock: Clock = FixedClock(Instant.parse("2026-10-19T02:00:00Z"))) {
        val repository: SyncLabRepository
        val account: SyncLabAccount
        val vault: KeystoreAuthVault
        val active: InMemoryActiveProfileStore
        val context: Context
        init {
            context = object : ContextWrapper(ApplicationProvider.getApplicationContext<Context>()) {
                override fun getNoBackupFilesDir() = dir.apply { mkdirs() }
            }
            val db = Room.inMemoryDatabaseBuilder(context, AyaDatabase::class.java).allowMainThreadQueries().build()
            val assetSource = AssetSource { path ->
                requireNotNull(requireNotNull(javaClass.classLoader).getResourceAsStream(path)).use { it.readBytes().decodeToString() }
            }
            active = InMemoryActiveProfileStore()
            repository = SyncLabRepository(
                context, db, active, assetSource, ContentRepository(assetSource, AppBuildInfo(true, "test")),
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
            val url = harness.account.beginGoogle()
            assertTrue(url.startsWith("http://127.0.0.1:${fake.http.port}/authorize?provider=google"))
            assertTrue(url.contains("code_challenge_method=s256"))
            val state = harness.account.googleState()!!
            assertTrue(url.contains(URLEncoder.encode("id.petalytix.ayailmu.synclab://auth-callback/$state", "UTF-8")))
            assertFalse(url.contains("client_secret"))
            // A pending intent completes once with its exact state; replays and wrong states fail closed.
            assertTrue(harness.account.completeGoogle(state, "auth-code-1"))
            assertFalse(harness.account.completeGoogle(state, "auth-code-1"))
            val second = harness.account.beginGoogle()
            assertFalse(harness.account.completeGoogle("wrong-state", "auth-code-2"))
            // Cancellation fails closed.
            val third = harness.account.beginGoogle()
            val state3 = harness.account.googleState()!!
            harness.account.cancelGoogle()
            assertFalse(harness.account.completeGoogle(state3, "auth-code-3"))
            // Any account change (e.g. sign-out) invalidates the pending intent generation.
            fake.fabricate("syn-c@example.invalid", "password-four")
            val fourth = harness.account.beginGoogle()
            val state4 = harness.account.googleState()!!
            harness.account.signOut()
            assertFalse(harness.account.completeGoogle(state4, "auth-code-4"))
            // A stale intent expires without exchanging; a clock rollback also fails closed.
            harness.account.beginGoogle()
            val state5 = harness.account.googleState()!!
            clock.advanceSeconds(601)
            assertFalse(harness.account.completeGoogle(state5, "auth-code-5"))
            harness.account.beginGoogle()
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
            // A newer account takes over while the stale refresh is in flight.
            assertTrue(harness.account.signIn("syn-a@example.invalid", "password-one"))
            val newer = harness.vault.read()!!
            refreshGate.countDown()
            assertFalse(restoring.await(), "The stale restore must fail")
            assertEquals(newer.session.accessToken, harness.vault.read()!!.session.accessToken, "Stale failure must not wipe the newer session")
            assertTrue(harness.repository.state.value.authenticated)
            harness.repository.stop()
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
            assertFalse(refreshing.await(), "The late refresh cannot complete after logout")
            assertTrue(fake.loggedOut.isNotEmpty(), "Provider logout is still attempted best-effort")
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
            // 2. Fixture account A: password sign-in matches the API's durable owner.
            val a = accounts.getValue("A").jsonObject
            val emailA = a.getValue("email").jsonPrimitive.content
            val passwordA = a.getValue("password").jsonPrimitive.content
            val tokenA = tokens.getValue("A").jsonPrimitive.content
            harness.account.signOut()
            assertTrue(harness.account.signIn(emailA, passwordA))
            assertEquals(api.currentAccount(tokenA), harness.repository.state.value.owner)
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
                // 4. Logout clears local state; a different fabricated owner gets a different namespace.
                relaunched.account.signOut()
                assertNull(relaunched.vault.read())
                assertNull(relaunched.repository.state.value.owner)
                val b = accounts.getValue("B").jsonObject
                assertTrue(relaunched.account.signIn(b.getValue("email").jsonPrimitive.content, b.getValue("password").jsonPrimitive.content))
                assertNotEquals(api.currentAccount(tokenA), relaunched.repository.state.value.owner)
                assertTrue(relaunched.repository.state.value.learners.isEmpty())
            } finally {
                relaunched.repository.stop()
            }
            println("REAL_ANDROID_ACCOUNT_E2E_PASS: real GoTrue signup; local Mailpit confirmation; password login; actual expired token refresh/rotation; logout; owner isolation")
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
}
