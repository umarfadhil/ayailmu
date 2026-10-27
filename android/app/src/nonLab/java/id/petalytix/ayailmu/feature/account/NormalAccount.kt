package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.sync.AuthFailure
import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.NormalOwnerDeclaration
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal enum class NormalMessage { SIGNUP_SENT, CONFIRMED, SIGNED_OUT, RESENT, RECOVERY_SENT, RESET_DONE, UNCONFIRMED, INVALID_LOGIN, INVALID_OTP, THROTTLED, OFFLINE, SESSION_EXPIRED, FAILED }
private enum class AuthOperation { SIGN_UP, SIGN_IN, CONFIRM, RESEND, RECOVER, RESET, RESTORE }
internal data class NormalAccountState(val email: String? = null, val busy: Boolean = false, val message: NormalMessage? = null)

internal interface NormalOwnerSync {
    suspend fun login(token: String, declaration: NormalOwnerDeclaration, accepted: () -> Boolean = { true }, onCommitted: ((Long) -> Unit)? = null)
    suspend fun resume(token: String, accepted: () -> Boolean = { true })
    suspend fun logout(accepted: () -> Boolean = { true })
    suspend fun expireSession(accepted: () -> Boolean = { true })
    suspend fun revertLogin(mark: Long, accepted: () -> Boolean)
}

/** Normal owner credentials. Every accepted session is checked against GoTrue's confirmed user before persistence. */
@Singleton
internal class NormalAccount @Inject constructor(
    private val auth: NormalAuthGateway,
    private val vault: NormalAuthVault,
    private val sync: NormalOwnerSync,
    private val clock: Clock,
    private val config: NormalAccountConfig,
) {
    private val lock = Any()
    private var generation = 0L
    private val sessionMutex = Mutex()
    private val mutable = MutableStateFlow(NormalAccountState())
    val state = mutable.asStateFlow()
    private fun now() = clock.now().toEpochMilli()
    private fun begin(): Pair<Long, () -> Boolean> {
        val attempt = synchronized(lock) { ++generation }
        return attempt to { synchronized(lock) { generation == attempt } }
    }
    private fun fence(): Pair<Long, () -> Boolean> {
        val attempt = synchronized(lock) { generation }
        return attempt to { synchronized(lock) { generation == attempt } }
    }
    private fun publish(accepted: () -> Boolean, email: String? = mutable.value.email, busy: Boolean = false, message: NormalMessage? = null) {
        synchronized(lock) { if (accepted()) mutable.value = NormalAccountState(email, busy, message) }
    }
    private fun saved(session: AuthSession) = SavedNormalAuth(session, now() + session.expiresIn * 1000, now(), config.publicOrigin)
    private suspend fun verified(session: AuthSession, email: String): AuthSession {
        val user = auth.user(session.accessToken)
        require(user.id == session.user.id && user.email.equals(email, ignoreCase = true) && !user.emailConfirmedAt.isNullOrBlank()) { "Confirmed owner verification failed" }
        return session.copy(user = user)
    }
    private fun install(accepted: () -> Boolean, session: AuthSession) {
        synchronized(lock) {
            check(accepted()) { "Account operation superseded" }
            vault.write(saved(session))
            mutable.value = NormalAccountState(email = session.user.email)
        }
    }
    private suspend fun credential(accepted: () -> Boolean, declaration: NormalOwnerDeclaration, operation: AuthOperation, message: NormalMessage?, block: suspend () -> AuthSession): Boolean {
        var committed: Long? = null
        return try {
            val session = block()
            check(accepted()) { "Account operation superseded" }
            sync.login(session.accessToken, declaration, accepted) { committed = it }
            install(accepted, session)
            if (message != null) publish(accepted, message = message)
            true
        } catch (e: CancellationException) {
            withContext(NonCancellable) {
                committed?.let { runCatching { sync.revertLogin(it, accepted) } }
                publish(accepted)
            }
            throw e
        } catch (e: Exception) {
            if (committed != null) runCatching { sync.revertLogin(committed!!, accepted) }
            publish(accepted, message = messageFor(e, operation))
            false
        }
    }
    suspend fun signUp(email: String, password: String, adultDeclaration: Boolean = false): Boolean {
        if (!adultDeclaration || !valid(email, password)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return run(accepted, AuthOperation.SIGN_UP) { auth.signUp(email.trim(), password); publish(accepted, message = NormalMessage.SIGNUP_SENT) }
    }
    suspend fun confirm(email: String, code: String, adultDeclaration: Boolean = false): Boolean {
        if (!adultDeclaration || !NormalInput.email(email) || !NormalInput.code(code)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return credential(accepted, declaration(), AuthOperation.CONFIRM, NormalMessage.CONFIRMED) { verified(auth.verifyOtp(email.trim(), code, "signup"), email.trim()) }
    }
    suspend fun signIn(email: String, password: String, adultDeclaration: Boolean = false): Boolean {
        if (!adultDeclaration || !valid(email, password)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return credential(accepted, declaration(), AuthOperation.SIGN_IN, null) { verified(auth.signIn(email.trim(), password), email.trim()) }
    }
    suspend fun resend(email: String): Boolean {
        if (!NormalInput.email(email)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return run(accepted, AuthOperation.RESEND) { auth.resend(email.trim()); publish(accepted, message = NormalMessage.RESENT) }
    }
    suspend fun recover(email: String): Boolean {
        if (!NormalInput.email(email)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return run(accepted, AuthOperation.RECOVER) { auth.recover(email.trim()); publish(accepted, message = NormalMessage.RECOVERY_SENT) }
    }
    suspend fun reset(email: String, code: String, newPassword: String): Boolean {
        if (!valid(email, newPassword) || !NormalInput.code(code)) return false
        val (_, accepted) = begin(); publish(accepted, busy = true)
        return run(accepted, AuthOperation.RESET) {
            val recovery = verified(auth.verifyOtp(email.trim(), code, "recovery"), email.trim())
            auth.updatePassword(recovery.accessToken, newPassword)
            runCatching { auth.signOut(recovery.accessToken) }
            clearLocal(accepted)
            publish(accepted, email = null, message = NormalMessage.RESET_DONE)
        }
    }
    suspend fun restore(): Boolean {
        val (_, accepted) = fence(); publish(accepted, busy = true)
        return try {
            sessionMutex.withLock {
                check(accepted()) { "Account operation superseded" }
                val stored = vault.read() ?: run { publish(accepted); return@withLock false }
                val live = try {
                    verified(stored.session, stored.session.user.email)
                } catch (e: Exception) {
                    // GoTrue v2 also reports an expired access token as 403 bad_jwt.
                    // Other forbidden responses must not trigger credential refresh.
                    if (e !is AuthFailure || !(e.status == 401 || e.status == 403 && e.code == "bad_jwt")) throw e
                    val rotated = auth.refresh(stored.session.refreshToken)
                    require(rotated.user.id == stored.session.user.id) { "Provider subject changed" }
                    verified(rotated, stored.session.user.email).also { synchronized(lock) { check(accepted()); vault.write(saved(it)) } }
                }
                sync.resume(live.accessToken, accepted)
                publish(accepted, email = live.user.email)
                accepted()
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (conclusivelyInvalid(e)) synchronized(lock) { if (accepted()) runCatching { vault.write(null) } }
            if (conclusivelyInvalid(e)) runCatching { sync.expireSession(accepted) }
            publish(accepted, message = messageFor(e, AuthOperation.RESTORE)); false
        }
    }
    suspend fun signOut(): Boolean {
        val (_, accepted) = begin(); publish(accepted, busy = true)
        val stored = runCatching { vault.read() }.getOrNull()
        val cleared = runCatching { clearLocal(accepted); true }.getOrElse { false }
        if (!cleared) { publish(accepted, message = NormalMessage.FAILED); return false }
        publish(accepted, email = null, message = NormalMessage.SIGNED_OUT)
        stored?.session?.accessToken?.let { runCatching { auth.signOut(it) } }
        return true
    }
    fun clearLocalAuthState() {
        val (_, accepted) = begin()
        synchronized(lock) { check(accepted()); vault.write(null) }
        mutable.value = NormalAccountState(message = NormalMessage.SIGNED_OUT)
    }
    private suspend fun clearLocal(accepted: () -> Boolean) {
        synchronized(lock) { check(accepted()); vault.write(null) }
        // Repository logout is local and independently cleans each owner-scoped component.
        sync.logout(accepted)
    }
    private fun declaration() = NormalOwnerDeclaration(config.ownerDeclarationVersion, true)
    fun cancel() {
        val (_, accepted) = begin()
        publish(accepted)
    }
    private suspend fun run(accepted: () -> Boolean, operation: AuthOperation, block: suspend () -> Unit): Boolean = try {
        block(); accepted()
    } catch (e: CancellationException) { throw e } catch (e: Exception) { publish(accepted, message = messageFor(e, operation)); false }
    private fun valid(email: String, password: String) = NormalInput.email(email) && NormalInput.password(password)
    private fun conclusivelyInvalid(e: Exception) = e is AuthFailure && e.status in setOf(400, 401) || e.message in setOf("Provider subject changed", "Refreshed account changed")
    private fun messageFor(e: Exception, operation: AuthOperation) = when {
        e is IOException || e.cause is IOException -> NormalMessage.OFFLINE
        e is AuthFailure && e.status == 429 -> NormalMessage.THROTTLED
        e is AuthFailure && e.code == "email_not_confirmed" -> NormalMessage.UNCONFIRMED
        e is AuthFailure && e.status in setOf(400, 401) && operation in setOf(AuthOperation.CONFIRM, AuthOperation.RESET) -> NormalMessage.INVALID_OTP
        e is AuthFailure && e.status in setOf(400, 401) && operation == AuthOperation.SIGN_IN -> NormalMessage.INVALID_LOGIN
        e is AuthFailure && e.status in setOf(400, 401) && operation == AuthOperation.RESTORE -> NormalMessage.SESSION_EXPIRED
        e.message in setOf("Provider subject changed", "Refreshed account changed") -> NormalMessage.SESSION_EXPIRED
        else -> NormalMessage.FAILED
    }
}
