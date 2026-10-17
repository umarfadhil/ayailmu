package id.petalytix.ayailmu.feature.settings

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.ARABIC_SCALE_MAX
import id.petalytix.ayailmu.core.data.repo.ARABIC_SCALE_MIN
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.TargetText
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.feature.common.shareIntent
import kotlinx.coroutines.delay

@Composable
fun SettingsRoute(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val chooserTitle = stringResource(R.string.export_chooser_title)
    LaunchedEffect(viewModel) {
        viewModel.shareRequests.collect { uris -> if (uris.isNotEmpty()) context.startActivity(shareIntent(uris, chooserTitle)) }
    }
    // Android 13+: the notification permission is asked only at the moment the adult turns the reminder on.
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            viewModel.onEvent(SettingsEvent.ReminderEnabled(enabled = true, permitted = granted))
        }
    SettingsScreen(
        state = state,
        onEvent = { event ->
            val needsPermission =
                event is SettingsEvent.ReminderEnabled &&
                    event.enabled &&
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            if (needsPermission) permission.launch(Manifest.permission.POST_NOTIFICATIONS) else viewModel.onEvent(event)
        },
        onBack = onBack,
    )
}

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onEvent: (SettingsEvent) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    LaunchedEffect(state.notice) {
        if (state.notice != null) {
            delay(5_000)
            onEvent(SettingsEvent.NoticeShown)
        }
    }
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        val d = state.data
        if (d == null) {
            if (!state.loading) Text(stringResource(R.string.settings_failed), style = MaterialTheme.typography.bodyLarge, color = colors.notYet)
        } else {
            state.notice?.let { NoticeText(it) }
            LanguageSection(d, state.busy, onEvent)
            SessionSection(d, state.busy, onEvent)
            if (d.showArabicSize) ArabicSizeSection(d, state.busy, onEvent)
            ReminderSection(d, state.busy, onEvent)
            if (d.profile.consentVersion != null) ConsentSection(state.busy, onEvent)
            if (d.isAdult) DataSection(state.busy, onEvent)
            AboutSection(d)
        }
        AyaSecondaryButton(text = stringResource(R.string.action_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun NoticeText(n: SettingsNotice) {
    val msg =
        when (n) {
            SettingsNotice.EXPORT_FAILED -> R.string.settings_notice_export_failed
            SettingsNotice.ACTION_FAILED -> R.string.settings_notice_failed
            SettingsNotice.NOTIFICATIONS_BLOCKED -> R.string.settings_notice_notifications_blocked
            SettingsNotice.LAST_ADULT -> R.string.settings_notice_last_adult
        }
    Text(stringResource(msg), style = MaterialTheme.typography.bodyMedium, color = AyaThemeTokens.colors.notYet)
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = AyaThemeTokens.colors.ink, modifier = Modifier.headingSemantics())
}

@Composable
private fun LanguageSection(
    d: SettingsData,
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    PaperCard {
        SectionTitle(stringResource(R.string.settings_language))
        listOf(Lang.ID to R.string.lang_name_id, Lang.EN to R.string.lang_name_en).forEach { (lang, name) ->
            OptionCard(
                state = if (d.profile.lang == lang) ChoiceState.SELECTED else ChoiceState.IDLE,
                enabled = !busy,
                compact = true,
                onClick = { if (d.profile.lang != lang) onEvent(SettingsEvent.Language(lang)) },
            ) { Text(stringResource(name), style = MaterialTheme.typography.bodyLarge, color = AyaThemeTokens.colors.ink) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SessionSection(
    d: SettingsData,
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        SectionTitle(stringResource(R.string.settings_session_length))
        Text(stringResource(R.string.settings_session_length_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            val choices: List<Int?> = listOf(null) + d.sessionOptions
            choices.forEach { m ->
                OptionCard(
                    state = if (d.profile.sessionMinutes == m) ChoiceState.SELECTED else ChoiceState.IDLE,
                    enabled = !busy,
                    compact = true,
                    fillWidth = false,
                    onClick = { onEvent(SettingsEvent.SessionMinutes(m)) },
                ) {
                    Text(
                        text = if (m == null) stringResource(R.string.settings_session_auto) else stringResource(R.string.settings_minutes, m),
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun ArabicSizeSection(
    d: SettingsData,
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    // Local while dragging; saved once when the finger lifts.
    var scale by remember(d.profile.arabicScale) { mutableFloatStateOf(d.profile.arabicScale) }
    val label = stringResource(R.string.settings_arabic_size)
    PaperCard {
        SectionTitle(label)
        TargetText(stringResource(R.string.settings_arabic_sample), modifier = Modifier.fillMaxWidth(), scale = scale)
        Slider(
            value = scale,
            onValueChange = { scale = it },
            onValueChangeFinished = { onEvent(SettingsEvent.ArabicScale(scale)) },
            valueRange = ARABIC_SCALE_MIN..ARABIC_SCALE_MAX,
            steps = ARABIC_STEPS,
            enabled = !busy,
            colors = SliderDefaults.colors(thumbColor = colors.accent, activeTrackColor = colors.accent, inactiveTrackColor = colors.inkSoft.copy(alpha = 0.3f)),
        )
        Text(stringResource(R.string.settings_text_size_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    }
}

/** 0.8, 1.0, … 2.0: five stops between the two ends. */
private const val ARABIC_STEPS = 5

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderSection(
    d: SettingsData,
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var pickTime by remember { mutableStateOf(false) }
    val r = d.reminder
    PaperCard {
        SectionTitle(stringResource(R.string.settings_reminder))
        Text(stringResource(R.string.settings_reminder_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = AyaSpacing.touch)
                    .toggleable(value = r.enabled, enabled = d.isAdult && !busy, role = Role.Switch) { onEvent(SettingsEvent.ReminderEnabled(it)) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (r.enabled) stringResource(R.string.settings_reminder_on, r.hour, r.minute) else stringResource(R.string.settings_reminder_off),
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = r.enabled,
                onCheckedChange = null,
                enabled = d.isAdult && !busy,
                colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = colors.paper),
            )
        }
        if (d.isAdult) {
            TextButton(onClick = { pickTime = true }, enabled = !busy) { Text(stringResource(R.string.settings_reminder_change_time), color = colors.accentDeep) }
        } else {
            Text(stringResource(R.string.settings_adult_only), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        }
    }
    if (pickTime) {
        val picker = rememberTimePickerState(initialHour = r.hour, initialMinute = r.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickTime = false },
            title = { Text(stringResource(R.string.settings_reminder_change_time)) },
            text = { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TimePicker(state = picker) } },
            confirmButton = {
                TextButton(onClick = {
                    pickTime = false
                    onEvent(SettingsEvent.ReminderTime(picker.hour, picker.minute))
                }) { Text(stringResource(R.string.settings_save)) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text(stringResource(R.string.dev_cancel)) } },
        )
    }
}

@Composable
private fun ConsentSection(
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var confirm by remember { mutableStateOf(false) }
    PaperCard {
        SectionTitle(stringResource(R.string.settings_consent))
        Text(stringResource(R.string.settings_consent_given), style = MaterialTheme.typography.bodyMedium, color = colors.ink)
        TextButton(onClick = { confirm = true }, enabled = !busy) { Text(stringResource(R.string.settings_consent_withdraw), color = colors.notYet) }
    }
    if (confirm) {
        ConfirmDialog(
            title = stringResource(R.string.settings_consent_withdraw_title),
            body = stringResource(R.string.settings_consent_withdraw_body),
            confirm = stringResource(R.string.settings_consent_withdraw),
            onConfirm = { onEvent(SettingsEvent.WithdrawConsent) },
            onDismiss = { confirm = false },
        )
    }
}

@Composable
private fun DataSection(
    busy: Boolean,
    onEvent: (SettingsEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    var confirmProfile by remember { mutableStateOf(false) }
    var confirmAll by remember { mutableStateOf(false) }
    PaperCard {
        SectionTitle(stringResource(R.string.settings_data))
        Text(stringResource(R.string.settings_data_body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        AyaSecondaryButton(text = stringResource(R.string.settings_export), enabled = !busy, onClick = { onEvent(SettingsEvent.Export) }, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { confirmProfile = true }, enabled = !busy) { Text(stringResource(R.string.settings_delete_profile), color = colors.notYet) }
        TextButton(onClick = { confirmAll = true }, enabled = !busy) { Text(stringResource(R.string.dev_delete_all), color = colors.notYet) }
    }
    if (confirmProfile) {
        ConfirmDialog(
            title = stringResource(R.string.settings_delete_profile_title),
            body = stringResource(R.string.settings_delete_profile_body),
            confirm = stringResource(R.string.dev_delete_confirm_yes),
            onConfirm = { onEvent(SettingsEvent.DeleteProfile) },
            onDismiss = { confirmProfile = false },
        )
    }
    if (confirmAll) {
        ConfirmDialog(
            title = stringResource(R.string.dev_delete_confirm_title),
            body = stringResource(R.string.dev_delete_confirm_body),
            confirm = stringResource(R.string.dev_delete_confirm_yes),
            onConfirm = { onEvent(SettingsEvent.DeleteAll) },
            onDismiss = { confirmAll = false },
        )
    }
}

@Composable
private fun AboutSection(d: SettingsData) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        SectionTitle(stringResource(R.string.settings_about))
        Text(stringResource(R.string.settings_learner_id), style = MaterialTheme.typography.labelLarge, color = colors.inkSoft)
        // Long-press to copy: testers quote it when asking for deletion (Trial_App_Spec §11).
        SelectionContainer { Text(d.profile.id, style = MaterialTheme.typography.bodyMedium, color = colors.ink) }
        Text(stringResource(R.string.settings_contact, stringResource(R.string.contact_email)), style = MaterialTheme.typography.bodyMedium, color = colors.ink)
        Text(stringResource(R.string.settings_version, d.appVersion), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
    }
}

@Composable
private fun ConfirmDialog(
    title: String,
    body: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                onConfirm()
            }) { Text(confirm, color = AyaThemeTokens.colors.notYet) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.dev_cancel)) } },
    )
}

private val previewData =
    SettingsData(
        profile =
            Profile(
                id = "lrn-6f1c2a9e-1b7d-4c55-9c1e-2f5a7d0b3e11",
                label = "Umar",
                kind = ProfileKind.ADULT,
                createdBy = null,
                birthYear = 1990,
                audience = Audience.ADULTS,
                lang = Lang.ID,
                createdAtMs = 0L,
                sessionMinutes = 15,
                arabicScale = 1.2f,
                screensSeen = emptyList(),
                consentVersion = "arab-trial-1",
            ),
        sessionOptions = listOf(10, 15, 20),
        showArabicSize = true,
        reminder = ReminderSetting(enabled = true, hour = 19, minute = 30),
        appVersion = "0.1.0-demo",
    )

@Preview(name = "id · light", showBackground = true, locale = "id", heightDp = 1600)
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, heightDp = 1600)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f, heightDp = 2000)
@Composable
private fun SettingsPreview() {
    AyaTheme { PaperBackground { SettingsScreen(state = SettingsUiState(loading = false, data = previewData), onEvent = {}, onBack = {}) } }
}
