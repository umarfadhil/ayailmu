package id.petalytix.ayailmu.feature.synclab

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.sync.Learner
import id.petalytix.ayailmu.feature.consent.ConsentRoute
import id.petalytix.ayailmu.feature.session.SessionRoute
import id.petalytix.ayailmu.navigation.AyaRoute
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable private data object SyncLabHub
@Serializable private data object SyncLabSignIn
@Serializable private data object SyncLabSignUp
@Serializable private data class SyncLabConfirm(val email: String)
@Serializable private data class SyncLabRecover(val email: String)
@Serializable private data class SyncLabReset(val email: String)
@Serializable private data object SyncLabSettings

internal data class SyncLabScreen(val lab: SyncLabState, val account: AccountUi) {
    val busy: Boolean get() = lab.busy || account.busy
}

@HiltViewModel
internal class SyncLabViewModel @Inject constructor(
    private val repository: SyncLabRepository,
    private val account: SyncLabAccount,
) : ViewModel() {
    val state = combine(repository.state, account.state, ::SyncLabScreen)
        .stateIn(viewModelScope, SharingStarted.Eagerly, SyncLabScreen(SyncLabState(), AccountUi()))
    init { viewModelScope.launch { account.restore() } }
    private fun action(block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block() } catch (e: Exception) { repository.failed(e) }
        }
    }
    fun signIn(email: String, password: String, done: () -> Unit) = action { if (account.signIn(email, password)) done() }
    fun signUp(email: String, password: String, needsConfirm: (String) -> Unit) = action {
        if (account.signUp(email, password)) needsConfirm(email)
    }
    fun confirm(email: String, code: String, done: () -> Unit) = action { if (account.confirm(email, code)) done() }
    fun resend(email: String) = action { account.resend(email) }
    fun recover(email: String, sent: (String) -> Unit) = action { if (account.recover(email)) sent(email) }
    fun reset(email: String, code: String, newPassword: String, done: () -> Unit) = action {
        if (account.reset(email, code, newPassword)) done()
    }
    fun signOut() = action { account.signOut() }
    /** Attempts silent session recovery first, then reloads the account's learners. */
    fun refresh() = action {
        if (!repository.state.value.authenticated) account.refreshSession()
        repository.refresh()
    }
    fun restoreSession() = action { account.refreshSession() }
    fun create() = action { repository.create() }
    fun select(learner: Learner) = action { repository.select(learner) }
    fun enable() = action { repository.enable() }
    fun disable() = action { repository.disable() }
    fun sync() = action { repository.sync() }
    fun learn(ready: (Boolean) -> Unit) = action { ready(repository.prepareLearning()) }
}

/** This graph is compiled into syncLab only; no ordinary profile picker, purchases or real-data entry. */
@Composable
fun SyncLabApp() {
    val vm: SyncLabViewModel = hiltViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    LaunchedEffect(state.lab.owner) {
        if (state.lab.owner == null) nav.popBackStack(SyncLabHub, inclusive = false)
    }
    NavHost(navController = nav, startDestination = SyncLabHub) {
        composable<SyncLabHub> {
            SyncLabHubScreen(
                state, vm,
                onSignIn = { nav.navigate(SyncLabSignIn) },
                onSignUp = { nav.navigate(SyncLabSignUp) },
                onSettings = { nav.navigate(SyncLabSettings) },
                onLearn = { vm.learn { consent -> nav.navigate(if (consent) AyaRoute.Consent("arab") else AyaRoute.Session("arab")) } },
            )
        }
        composable<SyncLabSignIn> {
            SignInScreen(state, vm,
                onBack = { nav.popBackStack() },
                onSignedIn = { nav.popBackStack(SyncLabHub, inclusive = false) },
                onCreateAccount = { nav.navigate(SyncLabSignUp) },
                onForgot = { nav.navigate(SyncLabRecover("")) },
            )
        }
        composable<SyncLabSignUp> {
            SignUpScreen(state, vm,
                onBack = { nav.popBackStack() },
                onNeedConfirm = { nav.navigate(SyncLabConfirm(it)) },
            )
        }
        composable<SyncLabConfirm> { entry ->
            ConfirmScreen(state, vm, email = entry.arguments?.getString("email").orEmpty(),
                onBack = { nav.popBackStack() },
                onConfirmed = { nav.popBackStack(SyncLabHub, inclusive = false) },
            )
        }
        composable<SyncLabRecover> { entry ->
            RecoverScreen(state, vm, email = entry.arguments?.getString("email").orEmpty(),
                onBack = { nav.popBackStack() },
                onSent = { nav.navigate(SyncLabReset(it)) },
            )
        }
        composable<SyncLabReset> { entry ->
            ResetScreen(state, vm, email = entry.arguments?.getString("email").orEmpty(),
                onBack = { nav.popBackStack() },
                onReset = { nav.popBackStack(SyncLabSignIn, inclusive = false) },
            )
        }
        composable<SyncLabSettings> {
            SettingsScreen(state, vm, onBack = { nav.popBackStack() })
        }
        composable<AyaRoute.Consent> {
            Column(Modifier.fillMaxSize()) {
                Text(stringResource(R.string.sync_lab_warning), modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.labelMedium)
                ConsentRoute(onAccepted = { nav.navigate(AyaRoute.Session("arab")) { popUpTo(AyaRoute.Consent("arab")) { inclusive = true } } }, onBack = { nav.popBackStack(SyncLabHub, false) })
            }
        }
        composable<AyaRoute.Session> {
            SessionRoute(onExit = { nav.popBackStack(SyncLabHub, false) }, onConsent = {
                nav.navigate(AyaRoute.Consent("arab")) { popUpTo(AyaRoute.Session("arab")) { inclusive = true } }
            })
        }
    }
}

@Composable
private fun SyncLabHubScreen(
    state: SyncLabScreen,
    vm: SyncLabViewModel,
    onSignIn: () -> Unit,
    onSignUp: () -> Unit,
    onSettings: () -> Unit,
    onLearn: () -> Unit,
) {
    var syntheticAck by rememberSaveable { mutableStateOf(false) }
    val lab = state.lab
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_warning))
        Text(stringResource(lab.notice), style = MaterialTheme.typography.bodyMedium)
        Row { Checkbox(checked = syntheticAck, onCheckedChange = { syntheticAck = it }, enabled = !busy); Text(stringResource(R.string.sync_lab_ack)) }
        if (lab.owner == null) {
            AyaButton(text = stringResource(R.string.sync_lab_login), onClick = onSignIn, enabled = syntheticAck && !busy)
            AyaSecondaryButton(text = stringResource(R.string.sync_lab_create_account), onClick = onSignUp, enabled = syntheticAck && !busy)
            GooglePrepButton(enabled = false)
        } else {
            AccountMessage(state.account.message)
            Text(stringResource(R.string.sync_lab_hub_signed_in, state.account.email ?: lab.owner), style = MaterialTheme.typography.titleMedium)
            if (!lab.authenticated) {
                Text(stringResource(R.string.sync_lab_login_required))
                AyaButton(text = stringResource(R.string.sync_lab_restore_session), onClick = vm::restoreSession, enabled = !busy)
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_sign_in_again), onClick = onSignIn, enabled = !busy)
            }
            AyaSecondaryButton(text = stringResource(R.string.sync_lab_settings), onClick = onSettings, enabled = !busy)
            if (lab.authenticated) {
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_refresh), onClick = vm::refresh, enabled = !busy)
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_new), onClick = vm::create, enabled = !busy)
            }
            lab.learners.forEach { learner ->
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_choose, learner.id.takeLast(8)), onClick = { vm.select(learner) }, enabled = !busy)
            }
            if (lab.selected != null) {
                Text(stringResource(R.string.sync_lab_local_only))
                AyaButton(text = stringResource(R.string.sync_lab_learn), onClick = onLearn, enabled = !busy)
                Text(stringResource(R.string.sync_lab_opt_in_detail))
                if (!lab.enabled) AyaSecondaryButton(text = stringResource(R.string.sync_lab_opt_in), onClick = vm::enable, enabled = lab.authenticated && syntheticAck && !busy)
                else AyaSecondaryButton(text = stringResource(R.string.sync_lab_disable), onClick = vm::disable, enabled = !busy)
                if (lab.withdrawalPending) Text(stringResource(R.string.sync_lab_withdraw_pending))
                Text(stringResource(R.string.sync_lab_pending, lab.pending))
                Text(stringResource(R.string.sync_lab_remote, lab.remoteAnswers, lab.learnedSkills))
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_sync), onClick = vm::sync, enabled = lab.authenticated && !busy)
            }
        }
    }
}

@Composable
private fun GooglePrepButton(enabled: Boolean) {
    AyaSecondaryButton(text = stringResource(R.string.sync_lab_google_disabled), onClick = {}, enabled = enabled)
}

@Composable
private fun AccountMessage(message: Int?) {
    if (message != null) Text(stringResource(message), style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun AuthFields(email: String, onEmail: (String) -> Unit, password: String, onPassword: (String) -> Unit, emailLabel: Int, passwordLabel: Int, enabled: Boolean) {
    AyaTextField(value = email, onValueChange = onEmail, label = stringResource(emailLabel), enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    AyaTextField(value = password, onValueChange = onPassword, label = stringResource(passwordLabel), enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = PasswordVisualTransformation())
}

@Composable
private fun SignInScreen(state: SyncLabScreen, vm: SyncLabViewModel, onBack: () -> Unit, onSignedIn: () -> Unit, onCreateAccount: () -> Unit, onForgot: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_login), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_warning))
        AccountMessage(state.account.message)
        AuthFields(email, { email = it }, password, { password = it }, R.string.sync_lab_email, R.string.sync_lab_password, enabled = !busy)
        AyaButton(text = stringResource(R.string.sync_lab_login), onClick = { vm.signIn(email.trim(), password) { onSignedIn() } }, enabled = !busy && email.trim().endsWith("@example.invalid") && password.isNotBlank())
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_create_account), onClick = onCreateAccount, enabled = !busy)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_forgot), onClick = onForgot, enabled = !busy)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !busy)
    }
}

@Composable
private fun SignUpScreen(state: SyncLabScreen, vm: SyncLabViewModel, onBack: () -> Unit, onNeedConfirm: (String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_sign_up_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_warning))
        AccountMessage(state.account.message)
        AuthFields(email, { email = it }, password, { password = it }, R.string.sync_lab_email, R.string.sync_lab_password, enabled = !busy)
        Text(stringResource(R.string.sync_lab_password_hint), style = MaterialTheme.typography.bodySmall)
        AyaButton(text = stringResource(R.string.sync_lab_sign_up_action), onClick = { vm.signUp(email.trim(), password) { onNeedConfirm(it) } }, enabled = !busy && email.trim().endsWith("@example.invalid") && password.isNotBlank())
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !busy)
    }
}

@Composable
private fun ConfirmScreen(state: SyncLabScreen, vm: SyncLabViewModel, email: String, onBack: () -> Unit, onConfirmed: () -> Unit) {
    var code by remember { mutableStateOf("") }
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_confirm_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_confirm_body, email))
        AccountMessage(state.account.message)
        AyaTextField(value = code, onValueChange = { code = it.filter(Char::isDigit).take(6) }, label = stringResource(R.string.sync_lab_code), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        AyaButton(text = stringResource(R.string.sync_lab_confirm_action), onClick = { vm.confirm(email, code) { onConfirmed() } }, enabled = !busy && code.length == 6)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_resend), onClick = { vm.resend(email) }, enabled = !busy)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !busy)
    }
}

@Composable
private fun RecoverScreen(state: SyncLabScreen, vm: SyncLabViewModel, email: String, onBack: () -> Unit, onSent: (String) -> Unit) {
    var value by rememberSaveable { mutableStateOf(email) }
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_recover_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_recover_body, value))
        AccountMessage(state.account.message)
        AyaTextField(value = value, onValueChange = { value = it }, label = stringResource(R.string.sync_lab_email), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        AyaButton(text = stringResource(R.string.sync_lab_recover_action), onClick = { vm.recover(value.trim()) { onSent(it) } }, enabled = !busy && value.trim().endsWith("@example.invalid"))
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !busy)
    }
}

@Composable
private fun ResetScreen(state: SyncLabScreen, vm: SyncLabViewModel, email: String, onBack: () -> Unit, onReset: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val busy = state.busy
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_reset_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_recover_body, email))
        AccountMessage(state.account.message)
        AyaTextField(value = code, onValueChange = { code = it.filter(Char::isDigit).take(6) }, label = stringResource(R.string.sync_lab_code), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        AyaTextField(value = password, onValueChange = { password = it }, label = stringResource(R.string.sync_lab_new_password), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = PasswordVisualTransformation())
        Text(stringResource(R.string.sync_lab_password_hint), style = MaterialTheme.typography.bodySmall)
        AyaButton(text = stringResource(R.string.sync_lab_reset_action), onClick = { vm.reset(email, code, password) { onReset() } }, enabled = !busy && code.length == 6 && password.isNotBlank())
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !busy)
    }
}

@Composable
private fun SettingsScreen(state: SyncLabScreen, vm: SyncLabViewModel, onBack: () -> Unit) {
    val lab = state.lab
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_settings), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_hub_signed_in, state.account.email ?: lab.owner.orEmpty()))
        AccountMessage(state.account.message)
        lab.selected?.let { Text(stringResource(R.string.sync_lab_settings_learner, it.clientLearnerId)) }
        Text(stringResource(if (lab.enabled) R.string.sync_lab_enabled else R.string.sync_lab_disabled))
        if (lab.withdrawalPending) Text(stringResource(R.string.sync_lab_withdraw_pending))
        Text(stringResource(R.string.sync_lab_pending, lab.pending))
        Text(stringResource(R.string.sync_lab_local_only))
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_disable), onClick = vm::disable, enabled = lab.enabled && !lab.busy)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_logout), onClick = vm::signOut, enabled = !lab.busy)
        AyaSecondaryButton(text = stringResource(R.string.sync_lab_back), onClick = onBack, enabled = !lab.busy)
    }
}
