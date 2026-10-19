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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.openid.appauth.CodeVerifierUtil

internal data class AccountUi(
    val email: String? = null,
    val busy: Boolean = false,
    val message: Int? = null,
)

/**
 * Connects the fabricated account UX to GoTrue and the owner-scoped sync engine.
 * Provider sessions are persisted only through [AuthVault] (Tink + Keystore, no-backup);
 * every credential write/clear and UI publish is fenced so a late provider response can
 * never restore another session after logout, overwrite a newer account, or reactivate
 * an old profile. Only fabricated `@example.invalid` identities ever reach the network.
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
    private val rotation = Mutex()
    /** Serializes cold restore and runtime refresh so a concurrent pair rotates the provider token at most once. */
    private val sessionMutex = Mutex()
    private val random = SecureRandom()
    private val mutable = MutableStateFlow(AccountUi())
    val state = mutable.asStateFlow()

    private fun begin(): Pair<Long, () -> Boolean> {
        val attempt = synchronized(lock) { ++generation }
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

    /**
     * Restores the durable owner on launch: reuse a live access token, else rotate the refresh
     * token once (serialized so rotation happens exactly once). Revoked/invalid material is
     * cleared only when no newer account has taken over in the meantime.
     */
    suspend fun restore(): Boolean {
        val (attempt, accepted) = fence()
        publish(busy = true)
        return try {
            sessionMutex.withLock {
                rotation.withLock {
                    check(accepted()) { "Sign-in cancelled" }
                    val saved = try { vault.read() } catch (e: Exception) { null }
                    if (saved == null) {
                        publish(busy = false)
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
                            check(accepted()) { "Sign-in cancelled" }
                            vault.write(SavedAuth(rotated, expiry(rotated), now()))
                            repository.resume(rotated.accessToken, accepted)
                            rotated
                        }
                        publish(email = live.user.email, busy = false)
                        true
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            clearIfCurrent(accepted, e)
            republishRepository(e)
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    /** Rotates an expired in-memory session at runtime (e.g. before a sync), verifying owner and subject. */
    suspend fun refreshSession(): Boolean {
        val (attempt, accepted) = fence()
        publish(busy = true)
        return try {
            sessionMutex.withLock {
                rotation.withLock {
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
                        check(accepted()) { "Sign-in cancelled" }
                        vault.write(SavedAuth(rotated, expiry(rotated), now()))
                        repository.resume(rotated.accessToken, accepted)
                        rotated
                    }
                    publish(email = live.user.email, busy = false)
                }
            }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            clearIfCurrent(accepted, e)
            republishRepository(e)
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun signIn(email: String, password: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            val session = auth.signIn(email, password)
            repository.login(session.accessToken, accepted)
            check(accepted()) { "Sign-in cancelled" }
            rotation.withLock { check(accepted()); vault.write(SavedAuth(session, expiry(session), now())) }
            publish(email = session.user.email, busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    /** Creates an unconfirmed fabricated account; GoTrue emails a synthetic confirmation code. */
    suspend fun signUp(email: String, password: String): Boolean {
        if (!syntheticIdentity(email)) return false
        begin()
        publish(busy = true)
        return try {
            auth.signUp(email, password)
            publish(busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun confirm(email: String, code: String): Boolean {
        if (!syntheticIdentity(email)) return false
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            val session = auth.verifyOtp(email, code, "signup")
            repository.login(session.accessToken, accepted)
            check(accepted()) { "Sign-in cancelled" }
            rotation.withLock { check(accepted()); vault.write(SavedAuth(session, expiry(session), now())) }
            publish(email = session.user.email, busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun resend(email: String): Boolean {
        if (!syntheticIdentity(email)) return false
        begin()
        publish(busy = true)
        return try {
            auth.resend(email)
            publish(busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    suspend fun recover(email: String): Boolean {
        if (!syntheticIdentity(email)) return false
        begin()
        publish(busy = true)
        return try {
            auth.recover(email)
            publish(busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    /** Consumes a recovery code, sets the new password and ends the recovery session; fresh sign-in follows. */
    suspend fun reset(email: String, code: String, newPassword: String): Boolean {
        if (!syntheticIdentity(email)) return false
        begin()
        publish(busy = true)
        return try {
            val recovery = auth.verifyOtp(email, code, "recovery")
            auth.updatePassword(recovery.accessToken, newPassword)
            runCatching { auth.signOut(recovery.accessToken) }
            publish(busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    /**
     * Clears local credentials and selection immediately — without waiting for any in-flight
     * refresh — and attempts provider logout best-effort. A storage failure cannot keep local
     * authentication alive; the durable owner/session are dropped first.
     */
    suspend fun signOut() {
        begin()
        publish(busy = true)
        val saved = try { vault.read() } catch (e: Exception) { null }
        repository.logout()
        try {
            vault.write(null)
        } catch (e: Exception) {
            // Storage failure must not resurrect local auth; the provider session is ended below.
        }
        publish(email = null, busy = false)
        val access = saved?.session?.accessToken
        if (access != null) runCatching { auth.signOut(access) }
    }

    // --- Disabled Google preparation: no live provider, fails closed until credentials are approved. ---

    private var pendingGoogle: PendingGoogle? = null
    private data class PendingGoogle(val verifier: String, val state: String, val generation: Long, val createdAtMs: Long)

    fun beginGoogle(): String {
        val verifier = CodeVerifierUtil.generateRandomCodeVerifier()
        val state = randomAlphanumeric(16)
        val url = auth.googleUrl(CodeVerifierUtil.deriveCodeVerifierChallenge(verifier), "$GOOGLE_REDIRECT/$state")
        pendingGoogle = PendingGoogle(verifier, state, currentGeneration(), now())
        return url
    }
    fun googleState(): String? = pendingGoogle?.state
    fun cancelGoogle() { pendingGoogle = null }

    /**
     * Binds a native callback to its exact pending intent: any logout/account change since
     * begin(), a wrong state path, a replay, expiry, or a clock rollback fails closed before
     * any code exchange.
     */
    suspend fun completeGoogle(state: String, code: String): Boolean {
        val pending = pendingGoogle
        pendingGoogle = null
        val fresh = pending != null &&
            pending.generation == currentGeneration() &&
            pending.state == state &&
            code.isNotBlank() && code.length <= 4096 &&
            now() - pending.createdAtMs in 0..GOOGLE_INTENT_MS
        if (!fresh) { publish(busy = false); return false }
        val (attempt, accepted) = begin()
        publish(busy = true)
        return try {
            val session = auth.exchangeCode(code, pending.verifier)
            repository.login(session.accessToken, accepted)
            check(accepted()) { "Sign-in cancelled" }
            rotation.withLock { check(accepted()); vault.write(SavedAuth(session, expiry(session), now())) }
            publish(email = session.user.email, busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            publish(busy = false, message = messageFor(e))
            false
        }
    }

    /** Clears unusable persisted material, but only when no newer account owns the vault now. */
    private fun clearIfCurrent(accepted: () -> Boolean, e: Exception) {
        val invalid = (e is AuthFailure && (e.status == 400 || e.status == 401)) ||
            e is ApiFailure || e.message == "Refreshed account changed" || e.message == "Provider subject changed"
        if (invalid && accepted()) runCatching { vault.write(null) }
    }

    /** Reflects a dead/changed session in the owner-scoped UI state without disturbing a newer account. */
    private suspend fun republishRepository(e: Exception) {
        try { repository.failed(e) } catch (ignored: Exception) { }
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
