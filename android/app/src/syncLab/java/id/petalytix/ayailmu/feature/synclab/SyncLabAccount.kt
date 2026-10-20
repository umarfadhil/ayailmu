package id.petalytix.ayailmu.feature.synclab

import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.sync.ApiFailure
import id.petalytix.ayailmu.core.sync.AuthFailure
import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.GoTrueAuth
import java.io.IOException
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.openid.appauth.CodeVerifierUtil

internal data class AccountUi(
    val email: String? = null,
    val busy: Boolean = false,
    val message: Int? = null,
)

/**
 * Connects the fabricated account UX to GoTrue and the owner-scoped sync engine.
 * Provider sessions are persisted only through [AuthVault] (Tink + Keystore, no-backup).
 *
 * Concurrency contract: every late effect — credential install/clear, UI publish, provider
 * logout — is bound to the generation captured when its operation began ([begin]) or observed
 * ([fence]). Check-and-act pairs that must survive generation changes on other dispatchers run
 * atomically under [lock]; no network runs under that lock, and the lock is never held across
 * provider/backend calls. Only fabricated `@example.invalid` identities ever reach the network.
 * The app never sees or stores passwords beyond transient fields.
 */
@Singleton
internal class SyncLabAccount @Inject constructor(
    private val auth: GoTrueAuth,
    private val vault: AuthVault,
    private val repository: SyncLabRepository,
    private val clock: Clock,
) {
    private val lock = Any()
    private var generation = 0L
    private val random = SecureRandom()
    /** Serializes restore/refresh so a concurrent pair rotates the provider token at most once. */
    private val sessionMutex = Mutex()
    private val mutable = MutableStateFlow(AccountUi())
    val state = mutable.asStateFlow()

    private fun begin(): Pair<Long, () -> Boolean> {
        val attempt: Long
        synchronized(lock) { generation++; googleAttempt++; attempt = generation }
        pendingGoogle = null
        return attempt to { synchronized(lock) { generation == attempt } }
    }
    /** Observes account changes without starting one: restore/refresh must not fence each other, only real account ops. */
    private fun fence(): Pair<Long, () -> Boolean> {
        val attempt = synchronized(lock) { generation }
        return attempt to { synchronized(lock) { generation == attempt } }
    }
    private fun currentGeneration(): Long = synchronized(lock) { generation }
    private fun now(): Long = clock.now().toEpochMilli()
    private fun expiry(session: AuthSession): Long = now() + session.expiresIn * 1_000

    /** The lab talks only to fabricated inboxes; this runs before any authentication network call. */
    private fun syntheticIdentity(email: String): Boolean {
        val ok = email.length <= 254 && email.endsWith("@example.invalid") &&
            email.count { it == '@' } == 1 && email.none(Char::isWhitespace)
        if (!ok) publish(message = R.string.sync_lab_error_synthetic)
        return ok
    }

    /** Atomically installs a provider session and its UI state, or throws if superseded/storage fails. */
    private fun install(accepted: () -> Boolean, session: AuthSession) {
        synchronized(lock) {
            check(accepted()) { "Sign-in cancelled" }
            vault.write(SavedAuth(session, expiry(session), now()))
            mutable.value = AccountUi(email = session.user.email, busy = false)
        }
    }

    private fun publishIfCurrent(accepted: () -> Boolean, email: String? = mutable.value.email, busy: Boolean = mutable.value.busy, message: Int? = null) {
        synchronized(lock) { if (accepted()) mutable.value = AccountUi(email = email, busy = busy, message = message) }
    }

    private fun clearVaultIfCurrent(accepted: () -> Boolean) {
        synchronized(lock) { if (accepted()) runCatching { vault.write(null) } }
    }

    private fun writeVaultIfCurrent(accepted: () -> Boolean, value: SavedAuth) {
        synchronized(lock) {
            check(accepted()) { "Sign-in cancelled" }
            vault.write(value)
        }
    }

    /**
     * Restores the durable owner on launch: reuse a live access token, else rotate the refresh
     * token once (serialized so rotation happens exactly once). Transient provider/backend
     * failures keep the persisted material for retry; only conclusively invalid material is
     * cleared, and only while no newer account has taken over.
     */
    suspend fun restore(): Boolean {
        val (attempt, accepted) = fence()
        publish(busy = true)
        return try {
            sessionMutex.withLock {
                check(accepted()) { "Sign-in cancelled" }
                val saved = try { vault.read() } catch (e: Exception) { null }
                if (saved == null) {
                    publishIfCurrent(accepted, busy = false)
                    false
                } else {
                    val live = try {
                        repository.resume(saved.session.accessToken, accepted)
                        saved.session
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        if (e !is ApiFailure || e.status != 401) throw e
                        val rotated = auth.refresh(saved.session.refreshToken)
                        checkSubject(saved.session, rotated)
                        writeVaultIfCurrent(accepted, SavedAuth(rotated, expiry(rotated), now()))
                        repository.resume(rotated.accessToken, accepted)
                        rotated
                    }
                    publishIfCurrent(accepted, email = live.user.email, busy = false)
                    accepted()
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (accepted()) {
                clearIfCurrent(accepted, e)
                republishRepository(e, accepted)
                publishIfCurrent(accepted, busy = false, message = messageFor(e))
            }
            false
        }
    }

    /** Rotates an expired in-memory session at runtime (e.g. before a sync), verifying owner and subject. */
    suspend fun refreshSession(): Boolean {
        val (attempt, accepted) = fence()
        publish(busy = true)
        return try {
            sessionMutex.withLock {
                check(accepted()) { "Sign-in cancelled" }
                val saved = try { vault.read() } catch (e: Exception) { null }
                    ?: throw ApiFailure(401, "unauthorized")
                val live = try {
                    repository.resume(saved.session.accessToken, accepted)
                    saved.session
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (e !is ApiFailure || e.status != 401) throw e
                    val rotated = auth.refresh(saved.session.refreshToken)
                    checkSubject(saved.session, rotated)
                    writeVaultIfCurrent(accepted, SavedAuth(rotated, expiry(rotated), now()))
                    repository.resume(rotated.accessToken, accepted)
                    rotated
                }
                publishIfCurrent(accepted, email = live.user.email, busy = false)
            }
            accepted()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (accepted()) {
                clearIfCurrent(accepted, e)
                republishRepository(e, accepted)
                publishIfCurrent(accepted, busy = false, message = messageFor(e))
            }
            false
        }
    }

    suspend fun signIn(email: String, password: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        var committed: Long? = null
        return try {
            val session = auth.signIn(email, password)
            repository.login(session.accessToken, accepted) { mark -> committed = mark }
            install(accepted, session)
            true
        } catch (e: CancellationException) {
            cleanupCancelledInstall(accepted, committed)
            throw e
        } catch (e: Exception) {
            if (accepted()) {
                cleanupFailedInstall(accepted, e, committed != null)
            }
            false
        }
    }

    /** Creates an unconfirmed fabricated account; GoTrue emails a synthetic confirmation code. */
    suspend fun signUp(email: String, password: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            auth.signUp(email, password)
            publishIfCurrent(accepted, busy = false)
            accepted()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publishIfCurrent(accepted, busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun confirm(email: String, code: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        var committed: Long? = null
        return try {
            val session = auth.verifyOtp(email, code, "signup")
            repository.login(session.accessToken, accepted) { mark -> committed = mark }
            install(accepted, session)
            true
        } catch (e: CancellationException) {
            cleanupCancelledInstall(accepted, committed)
            throw e
        } catch (e: Exception) {
            if (accepted()) {
                cleanupFailedInstall(accepted, e, committed != null)
            }
            false
        }
    }

    suspend fun resend(email: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            auth.resend(email)
            publishIfCurrent(accepted, busy = false)
            accepted()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publishIfCurrent(accepted, busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun recover(email: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            auth.recover(email)
            publishIfCurrent(accepted, busy = false)
            accepted()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publishIfCurrent(accepted, busy = false, message = messageFor(e))
            false
        }
    }

    /** Consumes a recovery code, sets the new password and ends the recovery session; fresh sign-in follows. */
    suspend fun reset(email: String, code: String, newPassword: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            val recovery = auth.verifyOtp(email, code, "recovery")
            auth.updatePassword(recovery.accessToken, newPassword)
            runCatching { auth.signOut(recovery.accessToken) }
            publishIfCurrent(accepted, busy = false)
            accepted()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publishIfCurrent(accepted, busy = false, message = messageFor(e))
            false
        }
    }

    /**
     * Clears local credentials and selection immediately — without waiting for any in-flight
     * refresh — and attempts provider logout best-effort. A storage failure in any one local
     * component cannot keep local authentication alive or skip another component's cleanup, and
     * a superseded logout never erases a newer account's credentials or UI.
     */
    suspend fun signOut() {
        val (attempt, accepted) = begin()
        publish(busy = true)
        val saved = try { vault.read() } catch (e: Exception) { null }
        repository.logout(accepted)
        clearVaultIfCurrent(accepted)
        publishIfCurrent(accepted, email = null, busy = false)
        val access = saved?.session?.accessToken
        if (access != null) runCatching { auth.signOut(access) }
    }

    // --- Disabled Google preparation: no live provider, fails closed until credentials are approved. ---

    private var pendingGoogle: PendingGoogle? = null
    private var googleAttempt = 0L
    private data class PendingGoogle(val verifier: String, val state: String, val generation: Long, val createdAtMs: Long)

    /** Prepared Google sign-in only ever runs from a fully signed-out state; linking/re-auth is not supported. */
    fun beginGoogle(): String? {
        if (repository.savedOwner() != null) return null
        val verifier = CodeVerifierUtil.generateRandomCodeVerifier()
        val state = randomAlphanumeric(16)
        val url = auth.googleUrl(CodeVerifierUtil.deriveCodeVerifierChallenge(verifier), "$GOOGLE_REDIRECT/$state")
        synchronized(lock) { googleAttempt++ }
        pendingGoogle = PendingGoogle(verifier, state, currentGeneration(), now())
        return url
    }
    fun googleState(): String? = pendingGoogle?.state
    fun cancelGoogle() {
        synchronized(lock) { googleAttempt++ }
        pendingGoogle = null
    }

    /**
     * Binds a native callback to its exact pending intent: any logout/account change since
     * begin(), a wrong state path, a replay, expiry, or a clock rollback fails closed before
     * any code exchange. The combined account-generation + Google-attempt fence then stays in
     * force through the backend learner load and the credential installation: cancelling or
     * replacing the intent at any point before installation discards the result and leaves no
     * cancelled authentication alive (without ever clearing a previous genuine session).
     */
    suspend fun completeGoogle(state: String, code: String): Boolean {
        val pending = pendingGoogle
        pendingGoogle = null
        val fresh = pending != null &&
            pending.generation == currentGeneration() &&
            pending.state == state &&
            code.isNotBlank() && code.length <= 4096 &&
            now() - pending.createdAtMs in 0..GOOGLE_INTENT_MS &&
            repository.savedOwner() == null
        if (!fresh) return false
        val (attempt, accepted) = begin()
        val myAttempt = synchronized(lock) { googleAttempt }
        val fence = { synchronized(lock) { googleAttempt == myAttempt } && accepted() }
        publish(busy = true)
        var committed: Long? = null
        return try {
            val session = auth.exchangeCode(code, pending.verifier)
            synchronized(lock) { check(googleAttempt == myAttempt) { "Google sign-in cancelled" } }
            repository.login(session.accessToken, fence) { mark -> committed = mark }
            synchronized(lock) { check(googleAttempt == myAttempt) { "Google sign-in cancelled" } }
            install(fence, session)
            true
        } catch (e: CancellationException) {
            cleanupCancelledInstall(accepted, committed)
            throw e
        } catch (e: Exception) {
            // Any failure after the attempt was cancelled/replaced (or a newer account op began) must
            // only drop effects this attempt actually installed: never a genuine previous vault session.
            val googleCancelled = synchronized(lock) { googleAttempt != myAttempt }
            if (googleCancelled) {
                committed?.let { mark -> runCatching { repository.revertLogin(mark, accepted) } }
            } else {
                cleanupFailedInstall(accepted, e, committed != null)
            }
            publishIfCurrent(accepted, busy = false, message = messageFor(e))
            false
        }
    }

    /** Clears persisted material only for conclusively invalid auth, and only while no newer account owns the vault. */
    private fun clearIfCurrent(accepted: () -> Boolean, e: Exception) {
        if (conclusivelyInvalid(e)) clearVaultIfCurrent(accepted)
    }

    /**
     * Attempt-owned cleanup when the coroutine itself is cancelled: bounded local work under
     * NonCancellable, then the CancellationException propagates. The committed-session mark was
     * recorded at the actual engine commit, so the revert only drops the session this attempt
     * installed — never a newer or genuine one — and busy is reset only while this attempt is
     * still current.
     */
    private suspend fun cleanupCancelledInstall(accepted: () -> Boolean, committed: Long?) {
        withContext(NonCancellable) {
            committed?.let { mark -> runCatching { repository.revertLogin(mark, accepted) } }
            publishIfCurrent(accepted, busy = false)
        }
    }

    /**
     * Fail-closed cleanup after a failed credential flow: the vault is cleared atomically and, only
     * when this operation actually committed a login, the in-memory session is expired — with the
     * operation fence carried to each mutation, so a newer login that completes during the
     * suspending repository work is never erased or expired.
     */
    private suspend fun cleanupFailedInstall(accepted: () -> Boolean, e: Exception, committed: Boolean) {
        clearVaultIfCurrent(accepted)
        if (committed) runCatching { repository.expireSession(accepted) }
        publishIfCurrent(accepted, busy = false, message = messageFor(e))
    }

    private fun conclusivelyInvalid(e: Exception): Boolean = when {
        e is AuthFailure && (e.status == 400 || e.status == 401) -> true
        e is ApiFailure && e.status == 401 -> true
        e.message == "Refreshed account changed" || e.message == "Provider subject changed" -> true
        else -> false
    }

    private fun checkSubject(previous: AuthSession, rotated: AuthSession) {
        check(rotated.user.id == previous.user.id) { "Provider subject changed" }
    }

    private fun randomAlphanumeric(length: Int): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        return (1..length).joinToString("") { alphabet[random.nextInt(alphabet.length)].toString() }
    }

    private fun publish(email: String? = mutable.value.email, busy: Boolean = mutable.value.busy, message: Int? = null) {
        mutable.value = AccountUi(email = email, busy = busy, message = message)
    }

    /** Reflects a failure in the owner-scoped UI state; the fence keeps a stale failure from publishing over a newer account. */
    private suspend fun republishRepository(e: Exception, accepted: () -> Boolean) {
        try { repository.failed(e, accepted) } catch (ignored: Exception) { }
    }

    private fun messageFor(e: Exception): Int = when {
        e is ApiFailure && (e.status == 401 || e.code == "fresh_authentication_required") -> R.string.sync_lab_error_session
        e is AuthFailure && e.status == 400 && e.code == "email_not_confirmed" -> R.string.sync_lab_error_unconfirmed
        e is IOException || e.cause is IOException -> R.string.sync_lab_error_offline
        else -> R.string.sync_lab_error_generic
    }

    companion object {
        const val GOOGLE_REDIRECT = "id.petalytix.ayailmu.synclab://auth-callback"
        private const val GOOGLE_INTENT_MS = 10 * 60_000L
    }
}
