package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.content.*
import id.petalytix.ayailmu.core.engine.*
import id.petalytix.ayailmu.core.model.*
import id.petalytix.ayailmu.core.sync.*
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.StepMapper
import id.petalytix.ayailmu.feature.session.StepUi
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import kotlin.random.Random

/** Actual Kotlin request generation and decoding through actual Go policy/adapters.
 * Only private pipes: provider, TLS metadata, mail and DB state are synthetic. */
class NativeWireIntegrationTest {
    private val origin = "https://general-beta.example.invalid"
    private val email = "learner.a@example.invalid"
    private val password = "fixture password one"
    private val source get() = File(requireNotNull(System.getenv("AYAILMU_NATIVE_WIRE_SOURCE")))
    private val mergedProdAssets get() = File(requireNotNull(System.getenv("AYAILMU_NATIVE_WIRE_ASSETS")))

    private inner class Pipe : AutoCloseable {
        val dir: File
        val process: Process
        private val input: BufferedReader
        private val output: BufferedWriter
        val requests = mutableListOf<Pair<String, String>>() // methods/paths only; never bodies/tokens
        var losePath: String? = null
        var holdPath: String? = null
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        init {
            val binary = System.getenv("AYAILMU_NATIVE_WIRE_BIN")
            assumeTrue("explicit offline Go bridge required", binary != null)
            dir = Files.createTempDirectory("ayailmu-native-wire-").toFile()
            val builder = ProcessBuilder(binary, "-test.run=^TestNativeWireBridgeHelper$")
            builder.environment().clear()
            builder.environment().putAll(mapOf("AYAILMU_NATIVE_WIRE_HELPER" to "1", "AYAILMU_NATIVE_WIRE_TEMP" to dir.path, "AYAILMU_NATIVE_WIRE_SOURCE" to source.path))
            val runtimeMode = System.getenv("AYAILMU_NATIVE_RUNTIME_WIRE") == "1"
            if (runtimeMode) builder.environment()["AYAILMU_NATIVE_RUNTIME_WIRE"] = "1"
            builder.redirectError(File(dir, "helper.stderr"))
            process = builder.start()
            input = process.inputStream.bufferedReader(); output = process.outputStream.bufferedWriter()
            assertEquals("explicit helper-mode handshake", runtimeMode, control("stats").getValue("runtime_http").jsonPrimitive.boolean)
        }
        @Synchronized fun exchange(value: JsonObject): JsonObject {
            output.write(value.toString()); output.newLine(); output.flush()
            // Helper has a 90s process deadline; requests themselves have 2s candidate deadline.
            return Json.parseToJsonElement(requireNotNull(input.readLine()) { "offline helper exited" }).jsonObject
        }
        fun control(name: String, seconds: Int = 0): JsonObject = Json.parseToJsonElement(exchange(buildJsonObject { put("Control", name); put("Seconds", seconds) }).getValue("body").jsonPrimitive.content).jsonObject
        fun mail() = control("stats").getValue("mail").jsonPrimitive.int
        fun factory(url: URL, @Suppress("UNUSED_PARAMETER") local: Boolean): HttpURLConnection = object : HttpURLConnection(url) {
            private val payload = ByteArrayOutputStream()
            private val headers = linkedMapOf<String, String>()
            private var reply: JsonObject? = null
            override fun setRequestProperty(key: String, value: String) { headers[key] = value }
            override fun getOutputStream(): OutputStream = payload
            override fun getResponseCode(): Int {
                if (reply == null) {
                    val target = url.path + if (url.query == null) "" else "?${url.query}"
                    requests += requestMethod to target
                    reply = exchange(buildJsonObject {
                        put("Method", requestMethod); put("Target", target); put("Peer", "192.0.2.1")
                        put("Body", payload.toString("UTF-8"))
                        put("Headers", buildJsonArray {
                            add(buildJsonArray { add("Host"); add(url.authority) })
                            headers.forEach { (k, v) -> add(buildJsonArray { add(k); add(v) }) }
                        })
                    })
                    if (url.path == holdPath) { entered.countDown(); check(release.await(5, TimeUnit.SECONDS)) }
                    if (url.path == losePath) { losePath = null; throw IOException("fixture reply lost after dispatch") }
                }
                return reply!!.getValue("status").jsonPrimitive.int
            }
            private fun response() = ByteArrayInputStream(reply!!.getValue("body").jsonPrimitive.content.encodeToByteArray())
            override fun getInputStream(): InputStream = response()
            override fun getErrorStream(): InputStream = response()
            override fun connect() = Unit
            override fun disconnect() = Unit
            override fun usingProxy() = false
        }
        override fun close() {
            release.countDown()
            try { if (process.isAlive) exchange(buildJsonObject { put("Control", "stop") }) }
            finally {
                output.close()
                // Drain the Go test runner's final PASS line before closing its stdout.
                // Closing earlier makes the runner fail with SIGPIPE after successful cleanup.
                input.readText(); input.close()
                if (!process.waitFor(5, TimeUnit.SECONDS)) { process.destroy(); if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly().waitFor(2, TimeUnit.SECONDS) }
                check(!process.isAlive) { "owned fixture process did not stop" }
                val code = process.exitValue()
                val remaining = dir.listFiles().orEmpty().filter { it.isDirectory }
                dir.deleteRecursively()
                check(code == 0 && remaining.isEmpty()) { "offline helper exit=$code remaining-ledger-directories=${remaining.size}" }
            }
        }
    }
    private class Vault : NormalAuthVault, NormalMailStore {
        var saved: SavedNormalAuth? = null
        var mail: SavedMailOperation? = null
        override fun read() = saved
        override fun write(value: SavedNormalAuth?) { saved = value }
        override fun readMail() = mail
        override fun writeMail(value: SavedMailOperation?) { mail = value }
    }
    private inner class Harness(val pipe: Pipe, val vault: Vault = Vault()) {
        val clock = FixedClock(Instant.parse("2026-10-30T00:00:00Z"))
        val contentCommit = Json.parseToJsonElement(File(source, "backend-umar/candidates/reviewed-math/local-client-proof.json").readText()).jsonObject.getValue("sourceCommit").jsonPrimitive.content
        val config = NormalAccountConfig.forValues(true, origin, "fixture-sync-v1", "fixture-adult-v1", contentCommit)
        val auth = GoTrueAuth(origin, connectionFactory = pipe::factory)
        val backend = HttpBackend(origin, false, "fixture-sync-v1", "fixture-adult-v1", pipe::factory)
        var owner: String? = null
        val sync = object : NormalOwnerSync {
            override suspend fun login(token: String, declaration: NormalOwnerDeclaration, accepted: () -> Boolean, onCommitted: ((Long) -> Unit)?) {
                check(accepted()); owner = backend.activateOwner(token, declaration.version, declaration.adultConfirmed); onCommitted?.invoke(1)
            }
            override suspend fun resume(token: String, accepted: () -> Boolean) { check(accepted()); owner = backend.currentAccount(token) }
            override suspend fun logout(accepted: () -> Boolean) { if (accepted()) owner = null }
            override suspend fun expireSession(accepted: () -> Boolean) { if (accepted()) owner = null }
            override suspend fun revertLogin(mark: Long, accepted: () -> Boolean) { if (accepted()) owner = null }
        }
        val account = NormalAccount(GoTrueNormalAuthGateway(config, auth), vault, sync, clock, config, NormalMailOperations(vault, clock, origin))
        val token get() = requireNotNull(vault.saved).session.accessToken
        suspend fun register(address: String = email) {
            assertTrue(account.signUp(address, password, true)); assertNull(vault.saved)
            assertFalse(account.signIn(address, password, true)); assertNull(vault.saved)
            assertEquals(NormalMessage.UNCONFIRMED, account.state.value.message)
            assertFalse(account.confirm(address, "000000", true)); assertNull(vault.saved)
            assertTrue(account.confirm(address, "123456", true)); assertEquals(address, account.state.value.email)
        }
    }
    private fun payloads(learner: String): List<String> {
        val assets = mergedProdAssets
        val pack = PackLoader.parse(File(assets, "packs/matematika/mat-a-local/v1.json").readText())
        val rules = RuleConfig.parse(File(assets, "config/rules.mat-a-local.json").readText())
        val content = Gating.gate(pack, developerDemo = false)
        val now = Instant.parse("2026-10-30T00:00:00Z").toEpochMilli()
        val ids = CountingIdGenerator()
        var state = Session.start(StartArgs(content, rules, emptyList(), learner, Lang.ID, Audience.ADULTS, now, ZoneId.of("UTC"), 5, emptyList(), "0.1.0-wire-test", Random(7), ids))
        val events = mutableListOf<AnswerEvent>()
        while (state.phase != SessionState.Phase.DONE) {
            val step = requireNotNull(state.currentStep)
            if (step.kind == Step.Kind.SCREEN) state = Session.advance(state, now)
            else {
                val item = content.item(step.id)
                val question = StepMapper.map(state, content, Lang.ID, null) as StepUi.Question
                val draft = AnswerDraft()
                when {
                    item.type == ItemType.INFO_CARD -> Unit // actual card renderer emits choice(seen)
                    item.type == ItemType.ESTIMATE_SLIDER -> draft.sliderValue = if (item.itemId == "MAT-A-P-01-002") 85000.0 else item.numeric!!.value
                    item.isNumeric -> draft.text = item.numeric!!.value.toString().removeSuffix(".0").replace('.', ',')
                    item.isChoiceFamily -> draft.choice = item.options.single { it.correct }.id
                    item.isSequence -> draft.placed.addAll(item.solution)
                    item.isPairs -> draft.pairs.putAll(item.solutionPairs)
                    else -> error("unsupported reviewed item")
                }
                val answer = requireNotNull(draft.toResponse(question))
                val result = Session.submit(state, answer, Env(content, rules, events, now, 1000, ids = ids))
                events += requireNotNull(result.event); state = Session.advance(result.state, now)
            }
        }
        assertEquals(7, events.size)
        return events.map { ContentJson.json.encodeToString(AnswerEvent.serializer(), it) }
    }
    @Test fun nativeSignupConfirmationLessonsReplayRestartAndAccountIsolation() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); a.register()
            assertNotEquals(a.owner, a.vault.saved!!.session.user.id)
            val learner = a.backend.createLearner(a.token, "same-local-id")
            val expected = Json { ignoreUnknownKeys = true }.decodeFromString(PackProof.serializer(), File(source, "backend-umar/candidates/reviewed-math/local-client-proof.json").readText())
            val proof = PackProof.fromBytes(File(mergedProdAssets, "packs/matematika/mat-a-local/v1.json").readBytes(), File(mergedProdAssets, "config/rules.mat-a-local.json").readBytes(), a.config.registrySourceCommit)
            assertEquals("actual ordinary-prod bytes must equal reviewed server proof", expected, proof)
            proof.verify(a.backend.catalog(a.token))
            val answers = payloads(learner.clientLearnerId)
            try { a.backend.append(a.token, learner.id, answers); fail("consent must precede sync") } catch (e: ApiFailure) { assertEquals(403, e.status) }
            a.backend.consent(a.token, learner.id, true)
            assertEquals(7, a.backend.append(a.token, learner.id, answers).size)
            assertTrue(a.backend.append(a.token, learner.id, answers).all { it.duplicate })
            val conflict = Json.parseToJsonElement(answers.first()).jsonObject.toMutableMap()
            conflict["time_on_item_ms"] = JsonPrimitive(1001)
            try { a.backend.append(a.token, learner.id, listOf(JsonObject(conflict).toString())); fail("immutable event collision") } catch (e: ApiFailure) { assertEquals(409, e.status) }
            val restored = Harness(p, a.vault); assertTrue(restored.account.restore()); assertEquals(a.owner, restored.owner)
            assertEquals(answers, restored.backend.pull(restored.token, learner.id, 0).events.map { it.payload })
            val b = Harness(p); b.register("learner.b@example.invalid")
            assertNotEquals(a.owner, b.owner); assertTrue(b.backend.learners(b.token).isEmpty())
            try { b.backend.pull(b.token, learner.id, 0); fail("cross-account read") } catch (e: ApiFailure) { assertEquals(404, e.status) }
            val second = b.backend.createLearner(b.token, "same-local-id"); assertNotEquals(learner.id, second.id)
            assertTrue(b.account.signOut()); assertNull(b.vault.saved); assertFalse(b.account.restore())
            assertEquals(7, a.backend.pull(a.token, learner.id, 0).events.size)
        }
    }
    @Test fun lostSignupReplyReusesIdAndRecreationNeverBlindlyResends() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); p.losePath = "/signup"
            assertFalse(a.account.signUp(email, password, true)); val id = a.vault.mail!!.id
            assertEquals(1, p.mail()); assertFalse(a.account.signUp(email, password, true)); assertEquals(id, a.vault.mail!!.id); assertEquals(1, p.mail())
            val recreated = Harness(p, a.vault); val before = p.requests.size
            assertFalse(recreated.account.signUp(email, password, true)); assertEquals(before, p.requests.size)
            assertTrue(recreated.account.confirm(email, "123456", true)); assertEquals(1, p.mail())
        }
    }
    @Test fun resendRecoveryResetAndOtpReplayUseNormalNativeContract() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); assertTrue(a.account.signUp(email, password, true)); p.control("advance", 61)
            assertTrue(a.account.resend(email)); assertTrue(a.account.confirm(email, "123456", true))
            assertFalse(a.account.confirm(email, "123456", true)); assertTrue(a.account.signOut())
            p.control("advance", 61); assertTrue(a.account.recover(email))
            assertTrue(a.account.reset(email, "123456", "fixture changed password")); assertNull(a.vault.saved)
            assertFalse(a.account.signIn(email, password, true)); assertTrue(a.account.signIn(email, "fixture changed password", true))
            assertEquals(3, p.mail())
        }
    }
    @Test fun cancellationFencesResponseAndRetryCannotSendAgain() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); p.holdPath = "/signup"
            val job = launch(Dispatchers.Default) { a.account.signUp(email, password, true) }
            assertTrue(p.entered.await(5, TimeUnit.SECONDS))
            assertFalse(a.account.signUp(email, password, true)) // duplicate tap while first dispatch is in flight
            job.cancel(); p.release.countDown(); job.join()
            assertNull(a.vault.saved); assertEquals(MailPhase.UNKNOWN, a.vault.mail!!.phase)
            p.holdPath = null; assertFalse(a.account.signUp(email, password, true)); assertEquals(1, p.mail())
        }
    }
    @Test fun refreshRotationLogoutStaleTokensAndOrdinaryServiceAvailability() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); a.register(); val first = a.vault.saved!!.session
            p.control("advance", 301) // model elapsed provider lifetime, not real-server expiry mutation
            assertTrue(a.account.restore())
            val refreshed = a.vault.saved!!.session; assertNotEquals(first.accessToken, refreshed.accessToken)
            try { a.auth.refresh(first.refreshToken); fail("stale refresh") } catch (e: AuthFailure) { assertEquals(401, e.status) }
            a.auth.signOut(refreshed.accessToken)
            try { a.auth.user(refreshed.accessToken); fail("logged-out access") } catch (e: AuthFailure) { assertEquals(401, e.status) }
            try { a.auth.refresh(refreshed.refreshToken); fail("logged-out refresh") } catch (e: AuthFailure) { assertEquals(401, e.status) }
            p.control("advance", 3299)
            if (System.getenv("AYAILMU_NATIVE_RUNTIME_WIRE") == "1") {
                assertEquals(email, a.auth.signIn(email, password).user.email)
            } else {
                try { a.auth.signIn(email, password); fail("expired simulation") } catch (e: AuthFailure) { assertEquals(503, e.status) }
            }
        }
    }
    @Test fun ordinaryGatewayRestartPreservesProviderSessionAndOwner() = runBlocking {
        assumeTrue(System.getenv("AYAILMU_NATIVE_RUNTIME_WIRE") == "1")
        Pipe().use { p ->
            val a = Harness(p); a.register(); val owner = a.owner; val session = a.vault.saved!!.session
            p.control("restart_gateway")
            assertTrue(a.account.restore()); assertEquals(owner, a.owner)
            p.control("advance", 301); p.control("restart_gateway")
            assertTrue(a.account.restore()); assertEquals(owner, a.owner)
            assertNotEquals(session.accessToken, a.vault.saved!!.session.accessToken)
            assertEquals(1, p.mail())
            assertTrue(a.account.signOut()); p.control("restart_gateway")
            assertFalse(a.account.restore()); assertNull(a.vault.saved)
        }
    }
    @Test fun recoveryReplyLossAndRecreationReuseTheSameWireId() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); a.register(); assertTrue(a.account.signOut()); p.control("advance", 61)
            p.losePath = "/recover"; assertFalse(a.account.recover(email)); val id = a.vault.mail!!.id
            assertEquals(2, p.mail())
            val recreated = Harness(p, a.vault)
            assertFalse(recreated.account.recover(email)); assertEquals(id, a.vault.mail!!.id); assertEquals(2, p.mail())
            assertTrue(recreated.account.reset(email, "123456", "fixture recovered password"))
            assertTrue(recreated.account.signIn(email, "fixture recovered password", true))
        }
    }
    @Test fun nativeHundredEventEnvelopeUsesBackendRatherThanAuthBodyBound() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p); a.register()
            val learner = a.backend.createLearner(a.token, "batch-native-id")
            a.backend.consent(a.token, learner.id, true)
            val template = ContentJson.json.decodeFromString(AnswerEvent.serializer(), payloads(learner.clientLearnerId).first())
            // Copies of an actual UI/engine event vary only the synthetic answer ID.
            val batch = (1..100).map { n -> ContentJson.json.encodeToString(AnswerEvent.serializer(), template.copy(answerId = "batch-answer-$n")) }
            assertTrue(batch.sumOf { it.length } > 16384)
            assertEquals(100, a.backend.append(a.token, learner.id, batch).size)
            assertEquals(batch, a.backend.pull(a.token, learner.id, 0).events.map { it.payload })
            try { a.backend.append(a.token, learner.id, batch + batch.first()); fail("101-event batch") } catch (e: ApiFailure) { assertEquals(400, e.status) }
        }
    }
    @Test fun mailCooldownAndGlobalExhaustionDoNotDispatchExtraMail() = runBlocking {
        Pipe().use { p ->
            val a = Harness(p)
            a.auth.signUp(email, password, "signup-a")
            try { a.auth.resend(email, "resend-early"); fail("cooldown") } catch (e: AuthFailure) { assertEquals(429, e.status) }
            for (i in 1..7) a.auth.signUp("other.$i@example.invalid", password, "signup-$i")
            assertEquals(8, p.mail())
            try { a.auth.signUp("last@example.invalid", password, "signup-last"); fail("global mail budget") } catch (e: AuthFailure) { assertEquals(429, e.status) }
            assertEquals(8, p.mail())
        }
    }
}
