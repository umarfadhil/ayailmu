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

internal enum class NormalMessage { SIGNUP_SENT, CONFIRMED, SIGNED_OUT, RESENT, RECOVERY_SENT, RESET_DONE, UNCONFIRMED, INVALID_LOGIN, INVALID_OTP, THROTTLED, OFFLINE, SESSION_EXPIRED, MAIL_UNKNOWN, MAIL_NEW_REQUIRED, FAILED }
private enum class AuthOperation { SIGN_UP, SIGN_IN, CONFIRM, RESEND, RECOVER, RESET, RESTORE }
internal data class NormalAccountState(val email: String? = null, val busy: Boolean = false, val message: NormalMessage? = null, val mail: SavedMailOperation? = null)

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
    private val mail: NormalMailOperations,
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
    private fun publish(accepted: () -> Boolean, email: String? = mutable.value.email, busy: Boolean = false, message: NormalMessage? = null, pending: SavedMailOperation? = mutable.value.mail) {
        synchronized(lock) { if (accepted()) mutable.value = NormalAccountState(email, busy, message, pending) }
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
            mail.clear()
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
        if (!config.enabled || config.ownerSignInOnly) return false
        if (!adultDeclaration || !valid(email, password)) return false
        return mailOperation(NormalMailAction.SIGN_UP, email, password, NormalMessage.SIGNUP_SENT) { auth.signUp(it.recipient, password, it.id) }
    }
    suspend fun confirm(email: String, code: String, adultDeclaration: Boolean = false): Boolean {
        if (config.ownerSignInOnly) return false
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
        if (!config.enabled || config.ownerSignInOnly) return false
        if (!NormalInput.email(email)) return false
        return mailOperation(NormalMailAction.RESEND, email, "", NormalMessage.RESENT) { auth.resend(it.recipient, it.id) }
    }
    suspend fun recover(email: String): Boolean {
        if (!config.enabled || config.ownerSignInOnly) return false
        if (!NormalInput.email(email)) return false
        return mailOperation(NormalMailAction.RECOVER, email, "", NormalMessage.RECOVERY_SENT) { auth.recover(it.recipient, it.id) }
    }
    suspend fun reset(email: String, code: String, newPassword: String): Boolean {
        if (config.ownerSignInOnly) return false
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
                val stored = vault.read() ?: run { val pending = mail.pending("anonymous"); publish(accepted, message = pending?.let { NormalMessage.MAIL_UNKNOWN }, pending = pending); return@withLock false }
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
        publish(accepted, email = null, message = NormalMessage.SIGNED_OUT, pending = null)
        stored?.session?.accessToken?.let { runCatching { auth.signOut(it) } }
        return true
    }
    fun clearLocalAuthState() {
        val (_, accepted) = begin()
        mail.clear()
        synchronized(lock) { check(accepted()); vault.write(null) }
        mutable.value = NormalAccountState(message = NormalMessage.SIGNED_OUT)
    }
    private suspend fun clearLocal(accepted: () -> Boolean) {
        synchronized(lock) { check(accepted()); vault.write(null) }
        mail.clear()
        // Repository logout is local and independently cleans each owner-scoped component.
        sync.logout(accepted)
    }
    private fun declaration() = NormalOwnerDeclaration(config.ownerDeclarationVersion, true)
    private fun mailScope() = vault.read()?.session?.user?.id?.let { "owner:$it" } ?: "anonymous"
    fun newMailRequest(): Boolean = try { if (!mail.newIntent()) false else { val (_, accepted) = fence(); publish(accepted, pending = null); true } } catch (_: Exception) { false }
    private suspend fun mailOperation(action: NormalMailAction, email: String, password: String, success: NormalMessage, call: suspend (MailTicket) -> Unit): Boolean {
        val admission = try { mail.begin(action, email, password, mailScope()) } catch (_: Exception) { val (_, accepted) = fence(); publish(accepted, message = NormalMessage.FAILED); return false }
        if (admission is MailAdmission.Busy) return false
        val (_, accepted) = begin()
        if (admission is MailAdmission.NewIntentRequired) { publish(accepted, message = NormalMessage.MAIL_NEW_REQUIRED, pending = mail.pending(mailScope())); return false }
        if (admission is MailAdmission.AlreadyAccepted) { publish(accepted, message = success, pending = mail.pending(mailScope())); return true }
        val ticket = (admission as MailAdmission.Send).ticket
        return try {
            publish(accepted, busy = true, pending = mail.pending(mailScope()))
            call(ticket)
            mail.finish(ticket, MailPhase.ACCEPTED)
            publish(accepted, message = success, pending = mail.pending(mailScope()))
            accepted()
        } catch (e: CancellationException) {
            withContext(NonCancellable) { runCatching { mail.finish(ticket, MailPhase.UNKNOWN) }; publish(accepted, message = NormalMessage.MAIL_UNKNOWN) }
            throw e
        } catch (e: Exception) {
            runCatching { mail.finish(ticket, MailPhase.UNKNOWN) }
            val message = when { e is AuthFailure && e.status == 429 -> NormalMessage.THROTTLED; else -> NormalMessage.MAIL_UNKNOWN }
            publish(accepted, message = message, pending = runCatching { mail.pending(mailScope()) }.getOrNull())
            false
        }
    }
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
