package id.petalytix.ayailmu.feature.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import id.petalytix.ayailmu.core.sync.SyncResult
import id.petalytix.ayailmu.core.sync.Learner

internal interface NormalAccountEvents {
    fun show(target: NormalAccountMode, email: String = "")
    fun back()
    fun signUp(email: String, password: String, adult: Boolean)
    fun confirm(email: String, code: String, adult: Boolean)
    fun signIn(email: String, password: String, adult: Boolean)
    fun resend(email: String)
    fun recover(email: String)
    fun reset(email: String, code: String, password: String)
    fun restoreSession()
    fun signInAgain()
    fun signOut()
    fun createLearner(label: String, lang: String)
    fun selectLearner(learner: Learner)
    fun enableSync()
    fun eraseServerCopy(learnerId: String)
    fun disableSync()
    fun syncNow()
    fun startNewMailRequest() {}
    fun eraseAccount(owner: String) {}
    fun checkAccountErasure(request: String) {}
    fun retryAccountErasure(request: String) {}
    fun retryErasureStorage() {}
}

internal enum class NormalAccountMode { HUB, SIGN_IN, SIGN_UP, CONFIRM, RECOVER, RESET }
internal data class NormalAccountUiState(
    val enabled: Boolean,
    val mode: NormalAccountMode = NormalAccountMode.HUB,
    val account: NormalAccountState = NormalAccountState(),
    val sync: NormalSyncState = NormalSyncState(),
    val confirmationEmail: String = "",
    val erasure: NormalAccountErasureState = NormalAccountErasureState(restored = true),
) { val busy: Boolean get() = account.busy || sync.busy || erasure.busy || !erasure.restored || erasure.blocked }

@HiltViewModel
internal class NormalAccountViewModel @Inject constructor(
    private val account: NormalAccount,
    private val sync: NormalSyncRepository,
    private val config: NormalAccountConfig,
    private val erasure: NormalAccountErasure,
) : ViewModel(), NormalAccountEvents {
    private val mode = MutableStateFlow(NormalAccountMode.HUB)
    private val confirmationEmail = MutableStateFlow("")
    private var generation = 0L
    val state = combine(account.state, sync.state, mode, erasure.state) { a, s, m, e ->
        NormalAccountUiState(config.enabled, m, a, s, confirmationEmail.value, erasure = e)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, NormalAccountUiState(config.enabled, erasure = NormalAccountErasureState()))
    init { if (config.enabled) viewModelScope.launch { if (erasure.restore()) account.restore() } }
    private fun next(): Long = synchronized(this) { ++generation }
    private fun current(mark: Long) = synchronized(this) { generation == mark }
    override fun show(target: NormalAccountMode, email: String) { next(); confirmationEmail.value = email; mode.value = target }
    override fun back() { next(); account.cancel(); sync.cancelActions(); mode.value = NormalAccountMode.HUB }
    private fun action(mark: Long, block: suspend () -> Unit) {
        viewModelScope.launch {
            if (!config.enabled || !current(mark) || !erasure.state.value.restored || erasure.state.value.blocked || erasure.state.value.busy) return@launch
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { if (current(mark)) sync.failed(e) }
        }
    }
    override fun signUp(email: String, password: String, adult: Boolean) {
        val mark = next()
        action(mark) { if (account.signUp(email, password, adult) && current(mark)) { confirmationEmail.value = email.trim(); mode.value = NormalAccountMode.CONFIRM } }
    }
    override fun confirm(email: String, code: String, adult: Boolean) {
        val mark = next(); action(mark) { if (account.confirm(email, code, adult) && current(mark)) mode.value = NormalAccountMode.HUB }
    }
    override fun signIn(email: String, password: String, adult: Boolean) {
        val mark = next(); action(mark) { if (account.signIn(email, password, adult) && current(mark)) mode.value = NormalAccountMode.HUB }
    }
    override fun resend(email: String) { val mark = next(); action(mark) { account.resend(email) } }
    override fun recover(email: String) {
        val mark = next(); action(mark) { if (account.recover(email) && current(mark)) { confirmationEmail.value = email.trim(); mode.value = NormalAccountMode.RESET } }
    }
    override fun reset(email: String, code: String, password: String) {
        val mark = next(); action(mark) { if (account.reset(email, code, password) && current(mark)) mode.value = NormalAccountMode.SIGN_IN }
    }
    override fun signInAgain() {
        val mark = next()
        confirmationEmail.value = account.state.value.email.orEmpty()
        action(mark) { if (account.signOut() && current(mark)) mode.value = NormalAccountMode.SIGN_IN }
    }
    override fun signOut() { val mark = next(); action(mark) { account.signOut() } }
    override fun startNewMailRequest() { if (!state.value.busy) account.newMailRequest() }
    override fun createLearner(label: String, lang: String) { val mark = next(); action(mark) { sync.createAdult(label, lang) } }
    override fun selectLearner(learner: Learner) { val mark = next(); action(mark) { sync.select(learner) } }
    override fun enableSync() { val mark = next(); action(mark) { sync.enable() } }
    override fun eraseServerCopy(learnerId: String) { val mark = next(); action(mark) { sync.eraseServerCopy(learnerId) } }
    override fun disableSync() { val mark = next(); action(mark) { sync.disable() } }
    override fun restoreSession() { val mark = next(); action(mark) { account.restore() } }
    override fun syncNow() {
        val mark = next()
        action(mark) {
            var result = sync.sync()
            if (!current(mark)) return@action
            if (result == SyncResult.LOGIN_REQUIRED && account.restore()) result = sync.sync()
            if (current(mark) && result == SyncResult.LOGIN_REQUIRED) sync.failed(id.petalytix.ayailmu.core.sync.ApiFailure(401, "unauthorized"))
        }
    }
    override fun retryErasureStorage() { viewModelScope.launch { if (erasure.restore()) account.restore() } }
    override fun eraseAccount(owner: String) { viewModelScope.launch { erasure.confirm(owner) } }
    override fun checkAccountErasure(request: String) { viewModelScope.launch { erasure.check(request) } }
    override fun retryAccountErasure(request: String) { viewModelScope.launch { erasure.retry(request) } }
    override fun onCleared() {
        account.cancel()
        sync.cancelActions()
        super.onCleared()
    }
}
