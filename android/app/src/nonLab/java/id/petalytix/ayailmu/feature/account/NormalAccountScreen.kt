package id.petalytix.ayailmu.feature.account

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.theme.AyaSpacing

@Composable
internal fun NormalAccountRootEntry(onClick: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        Text(stringResource(R.string.normal_account_root_body), style = MaterialTheme.typography.bodyMedium)
        AyaSecondaryButton(stringResource(R.string.normal_account_root_action), onClick, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
internal fun NormalAccountSettingsEntry(onClick: () -> Unit) {
    if (BuildConfig.NORMAL_AUTH_APPROVED) {
        PaperCard {
            Text(stringResource(R.string.normal_account_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.normal_account_local_boundary), style = MaterialTheme.typography.bodyMedium)
            AyaSecondaryButton(text = stringResource(R.string.normal_account_open), onClick = onClick, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
internal fun NormalAccountRoute(onBack: () -> Unit, viewModel: NormalAccountViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val leave = { viewModel.back(); onBack() }
    BackHandler(onBack = leave)
    NormalAccountScreen(state, viewModel, leave)
}

@Composable
internal fun NormalAccountScreen(state: NormalAccountUiState, events: NormalAccountEvents, onBack: () -> Unit) {
    if (!state.enabled) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(AyaSpacing.lg)) {
            Text(stringResource(R.string.normal_account_unavailable))
            AyaSecondaryButton(stringResource(R.string.action_back), onBack)
        }
        return
    }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        Text(stringResource(R.string.normal_account_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.normal_account_local_boundary), style = MaterialTheme.typography.bodyMedium)
        Message(state.account.message)
        SyncMessage(state.sync.notice)
        when {
            state.account.email != null -> OwnerStatus(state, events)
            state.mode == NormalAccountMode.HUB || !state.emailActionsAllowed && state.mode != NormalAccountMode.SIGN_IN -> {
                AyaButton(stringResource(R.string.normal_account_sign_in), { events.show(NormalAccountMode.SIGN_IN) }, enabled = !state.busy)
                if (state.emailActionsAllowed) AyaSecondaryButton(stringResource(R.string.normal_account_register), { events.show(NormalAccountMode.SIGN_UP) }, enabled = !state.busy)
            }
            state.mode == NormalAccountMode.SIGN_IN -> SignIn(state, events)
            state.mode == NormalAccountMode.SIGN_UP -> SignUp(state, events)
            state.mode == NormalAccountMode.CONFIRM -> Confirm(state, events)
            state.mode == NormalAccountMode.RECOVER -> Recover(state, events)
            state.mode == NormalAccountMode.RESET -> Reset(state, events)
        }
        if (state.mode == NormalAccountMode.HUB || state.account.email != null && state.sync.selected != null) {
            AyaSecondaryButton(stringResource(R.string.action_back), onBack, enabled = !state.busy)
        }
    }
}

@Composable
private fun EmailPassword(email: String, onEmail: (String) -> Unit, password: String, onPassword: (String) -> Unit, busy: Boolean) {
    AyaTextField(email, onEmail, label = stringResource(R.string.normal_account_email), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    if (email.isNotEmpty() && !NormalInput.email(email)) Text(stringResource(R.string.normal_account_email_error), color = MaterialTheme.colorScheme.error)
    AyaTextField(password, onPassword, label = stringResource(R.string.normal_account_password), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = PasswordVisualTransformation())
    Text(stringResource(R.string.normal_account_password_hint), style = MaterialTheme.typography.bodySmall)
    if (password.isNotEmpty() && !NormalInput.password(password)) Text(stringResource(R.string.normal_account_password_error), color = MaterialTheme.colorScheme.error)
}
@Composable
private fun AdultDeclaration(checked: Boolean, onChange: (Boolean) -> Unit, busy: Boolean) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = AyaSpacing.touch).toggleable(checked, enabled = !busy, role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked, onCheckedChange = null, enabled = !busy)
        Text(stringResource(R.string.normal_account_adult_declaration), style = MaterialTheme.typography.bodyMedium)
    }
}
@Composable
private fun SignUp(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var email by rememberSaveable { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var adult by remember { mutableStateOf(false) }
    Text(stringResource(R.string.normal_account_register), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.normal_account_registration_body))
    EmailPassword(email, { email = it }, password, { password = it }, state.busy)
    AdultDeclaration(adult, { adult = it }, state.busy)
    AyaButton(stringResource(R.string.normal_account_register), { vm.signUp(email, password, adult) }, enabled = !state.busy && adult && NormalInput.email(email) && NormalInput.password(password))
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun SignIn(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var email by rememberSaveable(state.confirmationEmail) { mutableStateOf(state.confirmationEmail) }; var password by remember { mutableStateOf("") }; var adult by remember { mutableStateOf(false) }
    Text(stringResource(R.string.normal_account_sign_in), style = MaterialTheme.typography.titleLarge)
    EmailPassword(email, { email = it }, password, { password = it }, state.busy)
    AdultDeclaration(adult, { adult = it }, state.busy)
    AyaButton(stringResource(R.string.normal_account_sign_in), { vm.signIn(email, password, adult) }, enabled = !state.busy && adult && NormalInput.email(email) && NormalInput.password(password))
    if (state.emailActionsAllowed) AyaSecondaryButton(stringResource(R.string.normal_account_forgot), { vm.show(NormalAccountMode.RECOVER, email.trim()) }, enabled = !state.busy)
    if (state.emailActionsAllowed) AyaSecondaryButton(stringResource(R.string.normal_account_enter_code), { vm.show(NormalAccountMode.CONFIRM, email.trim()) }, enabled = !state.busy && NormalInput.email(email))
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun CodeField(code: String, onCode: (String) -> Unit, busy: Boolean) {
    AyaTextField(code, { onCode(it.filter(Char::isDigit).take(6)) }, label = stringResource(R.string.normal_account_code), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
}
@Composable
private fun Confirm(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var code by remember { mutableStateOf("") }; var adult by remember { mutableStateOf(false) }
    Text(stringResource(R.string.normal_account_confirm_title), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.normal_account_confirm_body, state.confirmationEmail))
    CodeField(code, { code = it }, state.busy)
    AdultDeclaration(adult, { adult = it }, state.busy)
    AyaButton(stringResource(R.string.normal_account_confirm_action), { vm.confirm(state.confirmationEmail, code, adult) }, enabled = !state.busy && adult && NormalInput.code(code))
    AyaSecondaryButton(stringResource(R.string.normal_account_resend), { vm.resend(state.confirmationEmail) }, enabled = !state.busy)
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun Recover(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var email by rememberSaveable(state.confirmationEmail) { mutableStateOf(state.confirmationEmail) }
    Text(stringResource(R.string.normal_account_recover_title), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.normal_account_recover_body))
    AyaTextField(email, { email = it }, label = stringResource(R.string.normal_account_email), enabled = !state.busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    if (email.isNotEmpty() && !NormalInput.email(email)) Text(stringResource(R.string.normal_account_email_error), color = MaterialTheme.colorScheme.error)
    AyaButton(stringResource(R.string.normal_account_recover_action), { vm.recover(email) }, enabled = !state.busy && NormalInput.email(email))
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun Reset(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var code by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }
    Text(stringResource(R.string.normal_account_reset_title), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.normal_account_reset_body))
    CodeField(code, { code = it }, state.busy)
    AyaTextField(password, { password = it }, label = stringResource(R.string.normal_account_new_password), enabled = !state.busy, visualTransformation = PasswordVisualTransformation())
    Text(stringResource(R.string.normal_account_password_hint), style = MaterialTheme.typography.bodySmall)
    AyaButton(stringResource(R.string.normal_account_reset_action), { vm.reset(state.confirmationEmail, code, password) }, enabled = !state.busy && NormalInput.code(code) && NormalInput.password(password))
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun OwnerStatus(state: NormalAccountUiState, vm: NormalAccountEvents) {
    Text(stringResource(R.string.normal_account_signed_in_as, state.account.email.orEmpty()), style = MaterialTheme.typography.titleMedium)
    if (state.sync.notice == NormalSyncNotice.FRESH_AUTH_REQUIRED) {
        Text(stringResource(R.string.normal_account_fresh_auth_required))
        AyaButton(stringResource(R.string.normal_account_sign_in_again), vm::signInAgain, enabled = !state.busy)
    } else if (!state.sync.authenticated) {
        Text(stringResource(R.string.normal_account_session_restore))
        AyaButton(stringResource(R.string.normal_account_restore_action), vm::restoreSession, enabled = !state.busy)
    }
    state.sync.learners.forEach { learner ->
        val label = state.sync.learnerLabels[learner.clientLearnerId] ?: stringResource(R.string.normal_account_default_learner)
        AyaSecondaryButton(stringResource(R.string.normal_account_learner, label), { vm.selectLearner(learner) }, enabled = !state.busy)
    }
    state.sync.selected?.let { selected ->
        val label = state.sync.learnerLabels[selected.clientLearnerId] ?: stringResource(R.string.normal_account_default_learner)
        Text(stringResource(R.string.normal_account_bound_learner, label))
        Text(stringResource(if (state.sync.enabled) R.string.normal_account_sync_enabled else R.string.normal_account_sync_disabled))
        Text(stringResource(R.string.normal_account_pending, state.sync.pending))
        if (state.sync.enabled) AyaSecondaryButton(stringResource(R.string.normal_account_disable_sync), vm::disableSync, enabled = !state.busy)
        else AyaButton(stringResource(R.string.normal_account_enable_sync), vm::enableSync, enabled = !state.busy && state.sync.authenticated)
        AyaButton(stringResource(R.string.normal_account_sync_now), vm::syncNow, enabled = !state.busy && state.sync.enabled && state.sync.authenticated)
        Text(stringResource(R.string.normal_account_no_backfill), style = MaterialTheme.typography.bodySmall)
    }
    var label by rememberSaveable { mutableStateOf("") }
    AyaTextField(label, { label = it }, label = stringResource(R.string.normal_account_new_learner), enabled = !state.busy)
    AyaSecondaryButton(stringResource(R.string.normal_account_create_learner), { vm.createLearner(label, "id") }, enabled = !state.busy && state.sync.authenticated && label.isNotBlank())
    AyaSecondaryButton(stringResource(R.string.normal_account_logout), vm::signOut, enabled = !state.busy)
}
@Composable private fun Message(message: NormalMessage?) {
    val id = when (message) {
        NormalMessage.SIGNUP_SENT -> R.string.normal_account_signup_sent
        NormalMessage.CONFIRMED -> R.string.normal_account_confirmed
        NormalMessage.SIGNED_OUT -> R.string.normal_account_signed_out
        NormalMessage.RESENT -> R.string.normal_account_resent
        NormalMessage.RECOVERY_SENT -> R.string.normal_account_recovery_sent
        NormalMessage.RESET_DONE -> R.string.normal_account_reset_done
        NormalMessage.UNCONFIRMED -> R.string.normal_account_unconfirmed
        NormalMessage.INVALID_LOGIN -> R.string.normal_account_invalid_login
        NormalMessage.INVALID_OTP -> R.string.normal_account_invalid_otp
        NormalMessage.THROTTLED -> R.string.normal_account_throttled
        NormalMessage.OFFLINE -> R.string.normal_account_offline
        NormalMessage.SESSION_EXPIRED -> R.string.normal_account_session_expired
        NormalMessage.FAILED, null -> R.string.normal_account_failed
    }
    if (message != null) Text(stringResource(id), color = MaterialTheme.colorScheme.primary)
}
@Composable private fun SyncMessage(message: NormalSyncNotice) {
    val id = when (message) {
        NormalSyncNotice.SIGNED_OUT -> R.string.normal_account_signed_out
        NormalSyncNotice.READY -> R.string.normal_account_sync_ready
        NormalSyncNotice.OFFLINE -> R.string.normal_account_offline
        NormalSyncNotice.LOGIN_REQUIRED -> R.string.normal_account_session_restore
        NormalSyncNotice.FRESH_AUTH_REQUIRED -> R.string.normal_account_fresh_auth_required
        NormalSyncNotice.SYNCED -> R.string.normal_account_synced
        NormalSyncNotice.DISABLED -> R.string.normal_account_sync_disabled
        NormalSyncNotice.CONSENT_UPDATE_REQUIRED -> R.string.normal_account_consent_update
        NormalSyncNotice.NO_APPROVED_CONTENT -> R.string.normal_account_no_approved_content
        NormalSyncNotice.FAILED -> R.string.normal_account_failed
    }
    Text(stringResource(id), style = MaterialTheme.typography.bodySmall)
}
