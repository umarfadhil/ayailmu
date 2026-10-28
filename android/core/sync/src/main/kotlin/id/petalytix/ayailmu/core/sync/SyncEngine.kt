package id.petalytix.ayailmu.core.sync

import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ReviewStatus
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

enum class SyncMode { SYNTHETIC_LAB, NORMAL }

/** Owner-scoped sync state machine. Tokens are memory-only; durable state is owner/learner namespaced. */
class SyncEngine(private val api: Backend, private val journal: JournalStore, private val mode: SyncMode = SyncMode.SYNTHETIC_LAB) {
    private data class Session(val owner: String, val token: String, val generation: Long)
    private val lock = Any()
    private val syncLock = Mutex()
    private val consentLock = Mutex()
    private var generation = 0L
    private var session: Session? = null
    private val nativeJson = Json { ignoreUnknownKeys = false }

    fun owner(): String? = journal.read().activeOwner
    fun authenticated(): Boolean = synchronized(lock) { session != null }
    /** An opaque marker of the current session attempt; a new login/refresh/logout supersedes it. */
    fun sessionMark(): Long = synchronized(lock) { generation }
    /** The engine generation of the currently committed session; superseded by any newer login/refresh/logout. */
    fun sessionGeneration(): Long? = synchronized(lock) { session?.generation }
    fun binding(): Binding? = journal.read().let { s -> s.owners[s.activeOwner]?.get(s.activeLearner) }
    fun ownerForNativeProfile(profileId: String): String? = journal.read().owners.entries.firstOrNull { (_, b) -> b.values.any { it.learner.clientLearnerId == profileId } }?.key
    fun knownLearners(): List<Learner> = journal.read().let { it.owners[it.activeOwner].orEmpty().values.map(Binding::learner) }
    fun pendingCount(): Int = binding()?.local?.values?.count { it.acknowledgedSequence == null } ?: 0
    fun history(): List<RemoteRecord> = binding()?.takeIf { it.enabled }?.remote.orEmpty()

    suspend fun login(token: String, declaration: NormalOwnerDeclaration? = null, accepted: () -> Boolean = { true }, onCommitted: ((Long) -> Unit)? = null): String {
        val attempt = synchronized(lock) { check(accepted()) { "Sign-in cancelled" }; session = null; ++generation }
        val owner = if (mode == SyncMode.NORMAL) {
            val d = requireNotNull(declaration) { "Explicit adult owner declaration required" }
            require(d.adultConfirmed && d.version.isNotBlank())
            api.activateOwner(token, d.version, true)
        } else api.account(token)
        require(owner.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        synchronized(lock) {
            check(generation == attempt && accepted()) { "Sign-in session changed" }
            session = Session(owner, token, attempt)
            journal.update { it.copy(activeOwner = owner, activeLearner = it.activeLearner.takeIf { _ -> it.activeOwner == owner }) }
            // Hand the receipt to the caller at the actual commit, under the same lock: no suspension
            // or supersession can intervene before effect ownership is recorded.
            onCommitted?.invoke(attempt)
        }
        return owner
    }
    /**
     * Drops the committed session and durable owner only while the live session is still the one
     * [mark] identifies; a newer login/refresh/logout (even of the same owner) leaves it untouched.
     * The ownership check and the mutation are atomic under the engine lock.
     */
    fun logoutCommittedSession(mark: Long): Boolean = synchronized(lock) {
        if (session?.generation != mark) false
        else {
            session = null; generation++
            journal.update { it.copy(activeOwner = null, activeLearner = null) }
            true
        }
    }
    fun expireSession() = synchronized(lock) { session = null; generation++; Unit }
    /** Refresh/restore never repeats an adult declaration or resurrects a logged-out owner. */
    suspend fun resume(token: String, accepted: () -> Boolean = { true }) {
        val (expected, attempt) = synchronized(lock) {
            check(accepted()) { "Sign-in cancelled" }
            val owner = requireNotNull(journal.read().activeOwner) { "Explicit sign-in required" }
            session = null
            owner to ++generation
        }
        val verified = api.currentAccount(token)
        synchronized(lock) {
            check(generation == attempt && accepted()) { "Sign-in session changed" }
            require(verified == expected && journal.read().activeOwner == expected) { "Refreshed account changed" }
            session = Session(verified, token, attempt)
        }
    }
    fun deleteNativeProfile(profileId: String) = synchronized(lock) {
        check(mode == SyncMode.NORMAL)
        val deletingActive = journal.read().activeLearner?.let { active -> journal.read().owners[journal.read().activeOwner]?.get(active)?.learner?.clientLearnerId == profileId } == true
        if (deletingActive) session = null
        generation++
        journal.update { state ->
            val owners = state.owners.mapValues { (_, bindings) -> bindings.filterValues { it.learner.clientLearnerId != profileId } }
            state.copy(activeLearner = if (deletingActive) null else state.activeLearner, owners = owners)
        }
    }
    fun clearLocal() = synchronized(lock) {
        check(mode == SyncMode.NORMAL)
        session = null
        generation++
        journal.update { JournalSnapshot() }
    }
    fun logout() = synchronized(lock) {
        session = null; generation++
        journal.update { it.copy(activeOwner = null, activeLearner = null) }
        Unit
    }
    private fun context(): Session = synchronized(lock) { session ?: throw ApiFailure(401, "unauthorized") }
    private fun current(s: Session): Boolean = session == s
    private fun requireCurrent(s: Session) = check(current(s)) { "Sign-in session changed" }
    suspend fun availableLearners(): List<Learner> {
        val c = context(); val learners = api.learners(c.token)
        synchronized(lock) { requireCurrent(c) }
        return learners.filter {
            it.kind == "ADULT" && it.audience == "adults" &&
                (mode == SyncMode.NORMAL && !it.clientLearnerId.startsWith("syn_") || mode == SyncMode.SYNTHETIC_LAB && it.clientLearnerId.startsWith("syn_"))
        }
    }
    suspend fun createSyntheticLearner(): Learner {
        check(mode == SyncMode.SYNTHETIC_LAB)
        val c = context(); val learner = api.createLearner(c.token, "syn_" + c.owner + "_" + UUID.randomUUID())
        synchronized(lock) { requireCurrent(c) }
        return learner
    }
    /** Read-only: confirms the registry accepts [proofs], so callers can reject before any remote mutation. */
    suspend fun preflightProofs(proofs: Map<String, PackProof>) {
        require(proofs.isNotEmpty() && proofs.all { it.key == it.value.track })
        val c = context(); val catalog = api.catalog(c.token)
        synchronized(lock) { requireCurrent(c) }
        proofs.values.forEach { it.verify(catalog) }
    }
    suspend fun createNormalAdultLearner(clientId: String, lang: String, accepted: () -> Boolean = { true }): Learner {
        check(mode == SyncMode.NORMAL)
        require(clientId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")) && !clientId.startsWith("syn_") && lang in setOf("id", "en"))
        val c = context()
        check(accepted())
        val learner = api.createProfileLearner(c.token, clientId, "ADULT", lang)
        synchronized(lock) {
            requireCurrent(c)
            check(accepted())
            require(learner.kind == "ADULT" && learner.audience == "adults" && learner.clientLearnerId == clientId && learner.lang == lang)
        }
        return learner
    }
    suspend fun select(learner: Learner, proof: PackProof) = select(learner, mapOf(proof.track to proof))
    suspend fun select(learner: Learner, proofs: Map<String, PackProof>, accepted: () -> Boolean = { true }) {
        require(proofs.isNotEmpty() && proofs.all { it.key == it.value.track })
        check(accepted())
        val proof = proofs.values.first()
        require(
            learner.kind == "ADULT" && learner.audience == "adults" &&
                (mode == SyncMode.NORMAL && !learner.clientLearnerId.startsWith("syn_") ||
                    mode == SyncMode.SYNTHETIC_LAB && learner.clientLearnerId.startsWith("syn_")),
        ) { "Learner does not match this sync mode" }
        val c = context()
        val snapshot = journal.read()
        require(snapshot.owners.filterKeys { it != c.owner }.values.none { bindings -> bindings.values.any { it.learner.clientLearnerId == learner.clientLearnerId } }) { "Native profile ID belongs to another local owner" }
        val known = snapshot.owners[c.owner]?.get(learner.id)
        if (known == null) {
            require(api.learners(c.token).any { it == learner }) { "Learner is not owned by this account" }
            val catalog = api.catalog(c.token)
            proofs.values.forEach { it.verify(catalog) }
        } else require(known.learner == learner && known.proofs(proof) == proofs) { "Learner/provenance changed" }
        synchronized(lock) {
            requireCurrent(c)
            check(accepted())
            journal.update { state ->
                val bindings = state.owners[c.owner].orEmpty()
                state.copy(activeOwner = c.owner, activeLearner = learner.id, owners = state.owners + (c.owner to (bindings + (learner.id to (known ?: Binding(learner = learner, proof = proof, proofs = proofs))))))
            }
            session = c.copy(generation = ++generation)
        }
    }
    fun rollbackNormalSelection(learnerId: String, previousLearnerId: String?) = synchronized(lock) {
        check(mode == SyncMode.NORMAL)
        journal.update { state ->
            if (state.activeLearner != learnerId) state else state.copy(activeLearner = previousLearnerId)
        }
    }
    fun selectKnown(learnerId: String) = synchronized(lock) {
        journal.update { state ->
            require(state.owners[state.activeOwner]?.containsKey(learnerId) == true) { "Unknown offline learner" }
            state.copy(activeLearner = learnerId)
        }
        session = session?.copy(generation = ++generation)
    }
    private fun Binding.proofs(fallback: PackProof): Map<String, PackProof> = proofs.ifEmpty { mapOf(fallback.track to fallback) }
    private fun Binding.proofFor(track: String): PackProof = requireNotNull(proofs(proof)[track]) { "Track is not enrolled" }
    private fun update(owner: String, learnerId: String, f: (Binding) -> Binding) {
        journal.update { state ->
            val bindings = state.owners[owner] ?: error("Unknown owner")
            val value = bindings[learnerId] ?: error("Unknown learner")
            state.copy(owners = state.owners + (owner to (bindings + (learnerId to f(value)))))
        }
    }
    private fun updateCurrent(c: Session, id: String, f: (Binding) -> Binding): Boolean = synchronized(lock) {
        if (!current(c)) false else { update(c.owner, id, f); true }
    }
    private fun requireConsentCurrent(c: Session, b: Binding) = synchronized(lock) {
        requireCurrent(c)
        check(binding()?.consentRevision == b.consentRevision) { "Consent changed" }
    }
    suspend fun enable(existingAnswerIds: List<String>, accepted: () -> Boolean = { true }) {
        // Capture the user's intended revision before waiting for any earlier network operation.
        val (c, b) = synchronized(lock) { check(accepted()); context() to requireNotNull(binding()) }
        consentLock.withLock {
            requireConsentCurrent(c, b)
            val pending = flushWithdrawalsLocked(c)
            when (pending) {
                SyncResult.LOGIN_REQUIRED -> throw ApiFailure(401, "unauthorized")
                SyncResult.OFFLINE -> throw IOException("Withdrawal pending")
                SyncResult.BLOCKED, SyncResult.SESSION_CHANGED -> error("Withdrawal not confirmed")
                else -> Unit
            }
            requireConsentCurrent(c, b)
            val catalog = api.catalog(c.token)
            b.proofs(b.proof).values.forEach { it.verify(catalog) }
            requireConsentCurrent(c, b)
            check(accepted())
            api.consent(c.token, b.learner.id, true)
            check(accepted())
            check(updateCurrent(c, b.learner.id) {
                check(it.consentRevision == b.consentRevision) { "Consent changed" }
                it.copy(enabled = true, withdrawalPending = false, ignored = it.ignored + (existingAnswerIds.toSet() - it.local.keys))
            }) { "Session changed" }
        }
    }
    suspend fun disable(accepted: () -> Boolean = { true }): SyncResult {
        synchronized(lock) {
            check(accepted())
            val state = journal.read(); val owner = state.activeOwner ?: return SyncResult.CONSENT_OFF
            val id = state.activeLearner ?: return SyncResult.CONSENT_OFF
            update(owner, id) { it.copy(enabled = false, withdrawalPending = true, consentRevision = it.consentRevision + 1) }
        }
        return flushWithdrawals()
    }
    suspend fun flushWithdrawals(): SyncResult = consentLock.withLock {
        val c = synchronized(lock) { session } ?: return@withLock SyncResult.LOGIN_REQUIRED
        flushWithdrawalsLocked(c)
    }
    private suspend fun flushWithdrawalsLocked(c: Session): SyncResult {
        return try {
            val bindings = journal.read().owners[c.owner].orEmpty().values.filter { it.withdrawalPending }
            for (b in bindings) {
                synchronized(lock) { requireCurrent(c) }
                api.consent(c.token, b.learner.id, false)
                if (!updateCurrent(c, b.learner.id) {
                    if (it.consentRevision == b.consentRevision) it.copy(enabled = false, withdrawalPending = false) else it
                }) return SyncResult.SESSION_CHANGED
            }
            SyncResult.SYNCED
        } catch (e: Exception) { failure(c, e) }
    }
    /** Call only with original Room payload strings after its answer/snapshot transaction commits. */
    fun capture(payloads: List<String>, expectedLearnerId: String? = null) = synchronized(lock) {
        val state = journal.read(); val owner = state.activeOwner ?: return
        val id = state.activeLearner ?: return
        if (expectedLearnerId != null && expectedLearnerId != id) return
        update(owner, id) { b ->
            val local = b.local.toMutableMap(); val ignored = b.ignored.toMutableSet()
            for (raw in payloads) {
                require(raw.encodeToByteArray().size <= 16_384)
                val e = nativeJson.decodeFromString(AnswerEvent.serializer(), raw)
                require(e.learnerId == b.learner.clientLearnerId) { "Cross-learner answer" }
                val expected = when (mode) {
                    SyncMode.SYNTHETIC_LAB -> e.synthetic && e.itemId.startsWith("DEMO-")
                    SyncMode.NORMAL -> !e.synthetic && e.reviewStatus == ReviewStatus.APPROVED
                }
                if (!expected) {
                    require(mode == SyncMode.SYNTHETIC_LAB || !e.synthetic) { "Synthetic answer in normal namespace" }
                    continue
                }
                val answerProof = b.proofFor(e.track)
                require(e.contentVersion == answerProof.contentVersion && e.rulesVersion == answerProof.rulesVersion) { "Answer provenance mismatch" }
                val old = local[e.answerId]
                if (old != null) require(old.payload == raw) { "Frozen answer changed" }
                else if (!b.enabled) ignored += e.answerId
                else if (e.answerId !in ignored) local[e.answerId] = Captured(raw)
            }
            b.copy(local = local, ignored = ignored)
        }
    }
    suspend fun sync(accepted: () -> Boolean = { true }): SyncResult = syncLock.withLock {
        val c = synchronized(lock) { session } ?: return@withLock SyncResult.LOGIN_REQUIRED
        val b = binding() ?: return@withLock SyncResult.BLOCKED
        if (!b.enabled || b.withdrawalPending) return@withLock SyncResult.CONSENT_OFF
        try {
            val withdrawn = flushWithdrawals()
            if (withdrawn != SyncResult.SYNCED) return@withLock withdrawn
            val catalog = api.catalog(c.token)
            b.proofs(b.proof).values.forEach { it.verify(catalog) }
            for (batch in b.local.filterValues { it.acknowledgedSequence == null }.entries.chunked(50)) {
                if (!canSync(c, b.learner.id, accepted)) return@withLock stopped(c)
                val receipts = api.append(c.token, b.learner.id, batch.map { it.value.payload })
                require(receipts.size == batch.size && receipts.map { it.answerId }.toSet().size == batch.size)
                require(receipts.map { it.answerId }.toSet() == batch.map { it.key }.toSet())
                require(receipts.map { it.sequence }.toSet().size == receipts.size)
                require(receipts.all { it.sequence > 0 && (mode == SyncMode.NORMAL && it.registryStatus == "registered" || mode == SyncMode.SYNTHETIC_LAB && it.registryStatus in setOf("registered", "unregistered")) })
                if (!canSync(c, b.learner.id, accepted)) return@withLock stopped(c)
                if (!updateCurrent(c, b.learner.id) { old ->
                    val acknowledged = old.local.toMutableMap()
                    for (r in receipts) {
                        val sent = batch.single { it.key == r.answerId }.value.payload
                        val stored = requireNotNull(acknowledged[r.answerId]); require(stored.payload == sent)
                        acknowledged[r.answerId] = stored.copy(acknowledgedSequence = r.sequence)
                    }
                    old.copy(local = acknowledged)
                }) return@withLock SyncResult.SESSION_CHANGED
            }
            var more: Boolean
            do {
                if (!canSync(c, b.learner.id, accepted)) return@withLock stopped(c)
                val old = journal.read().owners[c.owner]!!.getValue(b.learner.id)
                val page = api.pull(c.token, b.learner.id, old.cursor)
                validatePage(page, old)
                if (!canSync(c, b.learner.id, accepted)) return@withLock stopped(c)
                if (!updateCurrent(c, b.learner.id) { latest ->
                    require(latest.cursor == old.cursor)
                    latest.copy(remote = latest.remote + page.events, cursor = page.nextCursor)
                }) return@withLock SyncResult.SESSION_CHANGED
                more = page.hasMore
            } while (more)
            SyncResult.SYNCED
        } catch (e: Exception) { failure(c, e) }
    }
    private fun validatePage(page: Page, b: Binding) {
        require(page.events.size <= 100 && (!page.hasMore || page.events.isNotEmpty()))
        var sequence = b.cursor
        val ids = b.remote.map { nativeJson.decodeFromString(AnswerEvent.serializer(), it.payload).answerId }.toMutableSet()
        for (record in page.events) {
            require(record.sequence == sequence + 1 && (mode == SyncMode.NORMAL && record.registryStatus == "registered" || mode == SyncMode.SYNTHETIC_LAB && record.registryStatus in setOf("registered", "unregistered")))
            val e = nativeJson.decodeFromString(AnswerEvent.serializer(), record.payload)
            require(
                (mode == SyncMode.NORMAL && !e.synthetic && e.reviewStatus == ReviewStatus.APPROVED ||
                    mode == SyncMode.SYNTHETIC_LAB && e.synthetic) &&
                    e.learnerId == b.learner.clientLearnerId && ids.add(e.answerId),
            )
            val proof = b.proofFor(e.track)
            require(e.contentVersion == proof.contentVersion && e.rulesVersion == proof.rulesVersion)
            sequence = record.sequence
        }
        require(page.nextCursor == sequence)
    }
    private fun canSync(c: Session, id: String, accepted: () -> Boolean): Boolean = synchronized(lock) { accepted() && current(c) && journal.read().owners[c.owner]?.get(id)?.let { it.enabled && !it.withdrawalPending } == true }
    private fun stopped(c: Session): SyncResult = synchronized(lock) { if (current(c)) SyncResult.CONSENT_OFF else SyncResult.SESSION_CHANGED }
    private fun failure(c: Session, e: Exception): SyncResult {
        if (e is CancellationException) throw e
        synchronized(lock) {
            if (!current(c)) return SyncResult.SESSION_CHANGED
            if (e is ApiFailure && e.code == "fresh_authentication_required") {
                session = null; generation++; return SyncResult.FRESH_AUTH_REQUIRED
            }
            if (e is ApiFailure && e.status == 401) {
                session = null; generation++; return SyncResult.LOGIN_REQUIRED
            }
            if (e is ApiFailure && e.code in setOf("sync_consent_required", "sync_consent_update_required")) {
                journal.read().activeLearner?.let { id -> update(c.owner, id) { it.copy(enabled = false) } }
                return if (e.code == "sync_consent_update_required") SyncResult.CONSENT_UPDATE_REQUIRED else SyncResult.CONSENT_OFF
            }
        }
        return if (e is IOException) SyncResult.OFFLINE else SyncResult.BLOCKED
    }
}
