package id.petalytix.ayailmu.core.sync

import id.petalytix.ayailmu.core.model.AnswerEvent
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

/** Synthetic integration state machine. Tokens are memory-only; all durable state is owner/learner scoped. */
class SyncEngine(private val api: Backend, private val journal: JournalStore) {
    private data class Session(val owner: String, val token: String, val generation: Long)
    private val lock = Any()
    private val syncLock = Mutex()
    private val consentLock = Mutex()
    private var generation = 0L
    private var session: Session? = null
    private val nativeJson = Json { ignoreUnknownKeys = false }

    fun owner(): String? = journal.read().activeOwner
    fun authenticated(): Boolean = synchronized(lock) { session != null }
    fun binding(): Binding? = journal.read().let { s -> s.owners[s.activeOwner]?.get(s.activeLearner) }
    fun knownLearners(): List<Learner> = journal.read().let { it.owners[it.activeOwner].orEmpty().values.map(Binding::learner) }
    fun pendingCount(): Int = binding()?.local?.values?.count { it.acknowledgedSequence == null } ?: 0
    fun history(): List<RemoteRecord> = binding()?.takeIf { it.enabled }?.remote.orEmpty()

    suspend fun login(token: String, accepted: () -> Boolean = { true }): String {
        val attempt = synchronized(lock) { check(accepted()) { "Sign-in cancelled" }; session = null; ++generation }
        val owner = api.account(token)
        require(owner.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        synchronized(lock) {
            check(generation == attempt && accepted()) { "Sign-in session changed" }
            session = Session(owner, token, attempt)
            journal.update { it.copy(activeOwner = owner, activeLearner = it.activeLearner.takeIf { _ -> it.activeOwner == owner }) }
        }
        return owner
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
        return learners.filter { it.kind == "ADULT" && it.audience == "adults" && it.clientLearnerId.startsWith("syn_") }
    }
    suspend fun createSyntheticLearner(): Learner {
        val c = context(); val learner = api.createLearner(c.token, "syn_" + c.owner + "_" + UUID.randomUUID())
        synchronized(lock) { requireCurrent(c) }
        return learner
    }
    suspend fun select(learner: Learner, proof: PackProof) {
        require(learner.kind == "ADULT" && learner.audience == "adults" && learner.clientLearnerId.startsWith("syn_")) { "Only fabricated adult lab learners can be linked" }
        val c = context()
        val snapshot = journal.read()
        require(snapshot.owners.filterKeys { it != c.owner }.values.none { bindings -> bindings.values.any { it.learner.clientLearnerId == learner.clientLearnerId } }) { "Native profile ID belongs to another local owner" }
        val known = snapshot.owners[c.owner]?.get(learner.id)
        if (known == null) {
            require(api.learners(c.token).any { it == learner }) { "Learner is not owned by this account" }
            proof.verify(api.catalog(c.token))
        } else require(known.learner == learner && known.proof == proof) { "Learner/provenance changed" }
        synchronized(lock) {
            requireCurrent(c)
            journal.update { state ->
                val bindings = state.owners[c.owner].orEmpty()
                state.copy(activeOwner = c.owner, activeLearner = learner.id, owners = state.owners + (c.owner to (bindings + (learner.id to (known ?: Binding(learner, proof))))))
            }
            session = c.copy(generation = ++generation)
        }
    }
    fun selectKnown(learnerId: String) = synchronized(lock) {
        journal.update { state ->
            require(state.owners[state.activeOwner]?.containsKey(learnerId) == true) { "Unknown offline learner" }
            state.copy(activeLearner = learnerId)
        }
        session = session?.copy(generation = ++generation)
    }
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
    suspend fun enable(existingAnswerIds: List<String>) {
        // Capture the user's intended revision before waiting for any earlier network operation.
        val (c, b) = synchronized(lock) { context() to requireNotNull(binding()) }
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
            b.proof.verify(api.catalog(c.token))
            requireConsentCurrent(c, b)
            api.consent(c.token, b.learner.id, true)
            check(updateCurrent(c, b.learner.id) {
                check(it.consentRevision == b.consentRevision) { "Consent changed" }
                it.copy(enabled = true, withdrawalPending = false, ignored = it.ignored + (existingAnswerIds.toSet() - it.local.keys))
            }) { "Session changed" }
        }
    }
    suspend fun disable(): SyncResult {
        synchronized(lock) {
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
                if (!e.synthetic || !e.itemId.startsWith("DEMO-")) continue
                require(e.track == b.proof.track && e.contentVersion == b.proof.contentVersion && e.rulesVersion == b.proof.rulesVersion) { "Answer provenance mismatch" }
                val old = local[e.answerId]
                if (old != null) require(old.payload == raw) { "Frozen answer changed" }
                else if (!b.enabled) ignored += e.answerId
                else if (e.answerId !in ignored) local[e.answerId] = Captured(raw)
            }
            b.copy(local = local, ignored = ignored)
        }
    }
    suspend fun sync(): SyncResult = syncLock.withLock {
        val c = synchronized(lock) { session } ?: return@withLock SyncResult.LOGIN_REQUIRED
        val b = binding() ?: return@withLock SyncResult.BLOCKED
        if (!b.enabled || b.withdrawalPending) return@withLock SyncResult.CONSENT_OFF
        try {
            val withdrawn = flushWithdrawals()
            if (withdrawn != SyncResult.SYNCED) return@withLock withdrawn
            b.proof.verify(api.catalog(c.token))
            for (batch in b.local.filterValues { it.acknowledgedSequence == null }.entries.chunked(50)) {
                if (!canSync(c, b.learner.id)) return@withLock stopped(c)
                val receipts = api.append(c.token, b.learner.id, batch.map { it.value.payload })
                require(receipts.size == batch.size && receipts.map { it.answerId }.toSet().size == batch.size)
                require(receipts.map { it.answerId }.toSet() == batch.map { it.key }.toSet())
                require(receipts.map { it.sequence }.toSet().size == receipts.size)
                require(receipts.all { it.sequence > 0 && it.registryStatus in setOf("registered", "unregistered") })
                if (!canSync(c, b.learner.id)) return@withLock stopped(c)
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
                if (!canSync(c, b.learner.id)) return@withLock stopped(c)
                val old = journal.read().owners[c.owner]!!.getValue(b.learner.id)
                val page = api.pull(c.token, b.learner.id, old.cursor)
                validatePage(page, old)
                if (!canSync(c, b.learner.id)) return@withLock stopped(c)
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
            require(record.sequence == sequence + 1 && record.registryStatus in setOf("registered", "unregistered"))
            val e = nativeJson.decodeFromString(AnswerEvent.serializer(), record.payload)
            require(e.synthetic && e.learnerId == b.learner.clientLearnerId && ids.add(e.answerId))
            sequence = record.sequence
        }
        require(page.nextCursor == sequence)
    }
    private fun canSync(c: Session, id: String): Boolean = synchronized(lock) { current(c) && journal.read().owners[c.owner]?.get(id)?.let { it.enabled && !it.withdrawalPending } == true }
    private fun stopped(c: Session): SyncResult = synchronized(lock) { if (current(c)) SyncResult.CONSENT_OFF else SyncResult.SESSION_CHANGED }
    private fun failure(c: Session, e: Exception): SyncResult {
        if (e is CancellationException) throw e
        synchronized(lock) {
            if (!current(c)) return SyncResult.SESSION_CHANGED
            if (e is ApiFailure && (e.status == 401 || e.code == "fresh_authentication_required")) {
                session = null; generation++; return SyncResult.LOGIN_REQUIRED
            }
            if (e is ApiFailure && e.code == "sync_consent_required") {
                journal.read().activeLearner?.let { id -> update(c.owner, id) { it.copy(enabled = false) } }
                return SyncResult.CONSENT_OFF
            }
        }
        return if (e is IOException) SyncResult.OFFLINE else SyncResult.BLOCKED
    }
}
