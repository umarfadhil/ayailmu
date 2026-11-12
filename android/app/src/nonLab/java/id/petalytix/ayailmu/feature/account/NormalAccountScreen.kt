package id.petalytix.ayailmu.feature.account

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
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
        if (state.emailActionsAllowed && state.account.mail != null && !state.busy) {
            val pending = state.account.mail
            AyaSecondaryButton(stringResource(R.string.normal_account_enter_code), {
                events.show(if (pending.action == NormalMailAction.RECOVER) NormalAccountMode.RESET else NormalAccountMode.CONFIRM, pending.recipient)
            })
            AyaSecondaryButton(stringResource(R.string.normal_account_new_mail_request), events::startNewMailRequest)
        }
        AccountErasureStatus(state, events)
        if (!state.sync.accountErasure) SyncMessage(state.sync.notice)
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
            AyaSecondaryButton(stringResource(R.string.action_back), onBack, enabled = !state.account.busy && !state.sync.busy && !state.erasure.busy)
        }
    }
}

@Composable
private fun AccountErasureStatus(state: NormalAccountUiState, events: NormalAccountEvents) {
    state.erasure.notice?.let { notice ->
        Text(stringResource(when (notice) {
            AccountErasureNotice.STORAGE_FAILED -> R.string.normal_account_delete_storage_failed
            AccountErasureNotice.FRESH_AUTH_REQUIRED -> R.string.normal_account_delete_fresh_auth
            AccountErasureNotice.SIGN_IN_REQUIRED -> R.string.normal_account_delete_sign_in
            AccountErasureNotice.CHECK_FAILED -> R.string.normal_account_delete_check_failed
        }), color = MaterialTheme.colorScheme.error)
        if (notice == AccountErasureNotice.STORAGE_FAILED) {
            AyaSecondaryButton(stringResource(R.string.normal_account_delete_storage_retry), events::retryErasureStorage, enabled = !state.erasure.busy && !state.account.busy && !state.sync.busy)
        }
        if (notice in setOf(AccountErasureNotice.FRESH_AUTH_REQUIRED, AccountErasureNotice.SIGN_IN_REQUIRED) && state.account.email != null) {
            AyaSecondaryButton(stringResource(R.string.normal_account_sign_in_again), events::signInAgain, enabled = !state.busy)
        }
    }
    state.erasure.records.forEach { record ->
        PaperCard {
            Text(stringResource(R.string.normal_account_delete_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(when (record.phase) {
                AccountErasurePhase.UNCONFIRMED -> R.string.normal_account_delete_unknown
                AccountErasurePhase.IDENTITY_PENDING -> R.string.normal_account_delete_identity_pending
                AccountErasurePhase.COMPLETED -> R.string.normal_account_delete_completed
            }))
            if (record.phase != AccountErasurePhase.COMPLETED) {
                AyaSecondaryButton(stringResource(R.string.normal_account_delete_check), { events.checkAccountErasure(record.request) }, enabled = !state.busy)
                if (record.phase == AccountErasurePhase.UNCONFIRMED && record.owner == state.sync.owner && state.sync.authenticated) {
                    AyaSecondaryButton(stringResource(R.string.normal_account_delete_retry), { events.retryAccountErasure(record.request) }, enabled = !state.busy)
                }
            }
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
    var email by remember(state.account.mail?.id) { mutableStateOf(state.account.mail?.recipient.orEmpty()) }; var password by remember { mutableStateOf("") }; var adult by remember { mutableStateOf(false) }
    Text(stringResource(R.string.normal_account_register), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.normal_account_registration_body))
    EmailPassword(email, { email = it }, password, { password = it }, state.busy)
    AdultDeclaration(adult, { adult = it }, state.busy)
    AyaButton(stringResource(R.string.normal_account_register), { vm.signUp(email, password, adult) }, enabled = !state.busy && adult && NormalInput.email(email) && NormalInput.password(password))
    AyaSecondaryButton(stringResource(R.string.action_back), vm::back, enabled = !state.busy)
}
@Composable
private fun SignIn(state: NormalAccountUiState, vm: NormalAccountEvents) {
    var email by remember(state.confirmationEmail) { mutableStateOf(state.confirmationEmail) }; var password by remember { mutableStateOf("") }; var adult by remember { mutableStateOf(false) }
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
    var email by remember(state.confirmationEmail) { mutableStateOf(state.confirmationEmail) }
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
    if (state.sync.accountErasure) {
        Text(stringResource(R.string.normal_account_delete_uploads_stopped))
    } else if (state.sync.notice == NormalSyncNotice.FRESH_AUTH_REQUIRED) {
        Text(stringResource(R.string.normal_account_fresh_auth_required))
        AyaButton(stringResource(R.string.normal_account_sign_in_again), vm::signInAgain, enabled = !state.busy)
    } else if (!state.sync.authenticated) {
        Text(stringResource(R.string.normal_account_session_restore))
        AyaButton(stringResource(R.string.normal_account_restore_action), vm::restoreSession, enabled = !state.busy)
    }
    if (!state.sync.accountErasure) state.sync.learners.forEach { learner ->
        val label = state.sync.learnerLabels[learner.clientLearnerId] ?: stringResource(R.string.normal_account_default_learner)
        AyaSecondaryButton(stringResource(R.string.normal_account_learner, label), { vm.selectLearner(learner) }, enabled = !state.busy)
    }
    if (!state.sync.accountErasure) state.sync.selected?.let { selected ->
        val label = state.sync.learnerLabels[selected.clientLearnerId] ?: stringResource(R.string.normal_account_default_learner)
        Text(stringResource(R.string.normal_account_bound_learner, label))
        Text(stringResource(if (state.sync.enabled) R.string.normal_account_sync_enabled else R.string.normal_account_sync_disabled))
        Text(stringResource(R.string.normal_account_pending, state.sync.pending))
        if (state.sync.serverCopyErased) Text(stringResource(R.string.normal_account_erase_done))
        else {
            if (state.sync.erasurePending) Text(stringResource(R.string.normal_account_erase_pending))
            else {
                if (state.sync.enabled) AyaSecondaryButton(stringResource(R.string.normal_account_disable_sync), vm::disableSync, enabled = !state.busy)
                else AyaButton(stringResource(R.string.normal_account_enable_sync), vm::enableSync, enabled = !state.busy && state.sync.authenticated)
                AyaButton(stringResource(R.string.normal_account_sync_now), vm::syncNow, enabled = !state.busy && state.sync.enabled && state.sync.authenticated)
            }
            var confirmErasure by remember(selected.id, state.sync.owner) { mutableStateOf(false) }
            AyaSecondaryButton(stringResource(if (state.sync.erasurePending) R.string.normal_account_erase_retry else R.string.normal_account_erase_server), { confirmErasure = true }, enabled = !state.busy && state.sync.authenticated)
            if (confirmErasure) AlertDialog(
                onDismissRequest = { confirmErasure = false },
                title = { Text(stringResource(R.string.normal_account_erase_title, label)) },
                text = { Text(stringResource(R.string.normal_account_erase_body)) },
                confirmButton = { TextButton(onClick = { confirmErasure = false; vm.eraseServerCopy(selected.id) }, enabled = !state.busy && state.sync.authenticated) { Text(stringResource(R.string.normal_account_erase_confirm)) } },
                dismissButton = { TextButton(onClick = { confirmErasure = false }) { Text(stringResource(android.R.string.cancel)) } },
            )
        }
        Text(stringResource(R.string.normal_account_no_backfill), style = MaterialTheme.typography.bodySmall)
    }
    if (!state.sync.accountErasure) {
    var label by rememberSaveable { mutableStateOf("") }
    if (state.sync.pendingCreate) Text(stringResource(R.string.normal_account_create_pending), style = MaterialTheme.typography.bodySmall)
    AyaTextField(label, { label = it }, label = stringResource(R.string.normal_account_new_learner), enabled = !state.busy)
    AyaSecondaryButton(stringResource(R.string.normal_account_create_learner), { vm.createLearner(label, "id") }, enabled = !state.busy && state.sync.authenticated && label.isNotBlank())
    }
    if (!state.sync.accountErasure && state.sync.owner != null) {
        val owner = state.sync.owner
        var confirmAccountErasure by remember(owner, state.account.email) { mutableStateOf(false) }
        AyaSecondaryButton(stringResource(R.string.normal_account_delete_title), { confirmAccountErasure = true }, enabled = !state.busy && state.sync.authenticated)
        if (confirmAccountErasure) AlertDialog(
            onDismissRequest = { confirmAccountErasure = false },
            title = { Text(stringResource(R.string.normal_account_delete_title)) },
            text = { Text(stringResource(R.string.normal_account_delete_body, state.account.email.orEmpty())) },
            confirmButton = { TextButton(onClick = { confirmAccountErasure = false; vm.eraseAccount(owner) }, enabled = !state.busy && state.sync.authenticated) { Text(stringResource(R.string.normal_account_delete_confirm)) } },
            dismissButton = { TextButton(onClick = { confirmAccountErasure = false }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }
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
        NormalMessage.MAIL_UNKNOWN -> R.string.normal_account_mail_unknown
        NormalMessage.MAIL_NEW_REQUIRED -> R.string.normal_account_mail_new_required
        NormalMessage.FAILED, null -> R.string.normal_account_failed
    }
    if (message != null) Text(stringResource(id), color = MaterialTheme.colorScheme.primary)
}
@Composable private fun SyncMessage(message: NormalSyncNotice) {
    if (message == NormalSyncNotice.SERVER_COPY_ERASED) return // The selected profile already shows its receipt.
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
        NormalSyncNotice.CONTENT_MISMATCH -> R.string.normal_account_content_mismatch
        NormalSyncNotice.CREATE_PENDING_LANGUAGE -> R.string.normal_account_create_pending_language
        NormalSyncNotice.SERVER_COPY_ERASED -> R.string.normal_account_erase_done
        NormalSyncNotice.DEPENDENT_LEARNERS -> R.string.normal_account_erase_dependents
        NormalSyncNotice.FAILED -> R.string.normal_account_failed
    }
    Text(stringResource(id), style = MaterialTheme.typography.bodySmall)
}
