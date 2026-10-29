package id.petalytix.ayailmu.feature.consent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Records consent for the active profile; an interface so the ViewModel is tested without Room. */
interface ConsentDataSource {
    /** False when the active profile's birth year says the learner is under 18. */
    suspend fun eligible(): Boolean

    suspend fun accept(version: String)
}

class DefaultConsentDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val clock: Clock,
    ) : ConsentDataSource {
        override suspend fun eligible(): Boolean = Consent.oldEnough(profiles.activeProfile()?.birthYear, clock.today().year)

        override suspend fun accept(version: String) {
            val profile = checkNotNull(profiles.activeProfile()) { "no active profile" }
            check(Consent.oldEnough(profile.birthYear, clock.today().year)) { "under 18" }
            profiles.recordConsent(profile.id, version)
        }
    }

data class ConsentUiState(
    val track: String = "",
    val adult: Boolean = false,
    val agree: Boolean = false,
    val busy: Boolean = false,
    val error: Boolean = false,
    val done: Boolean = false,
    /** The profile's birth year says under 18: the trial is closed to this profile. */
    val tooYoung: Boolean = false,
) {
    /** Both boxes, always; no consent means no session and no data (Trial_App_Spec §4). */
    val canAccept: Boolean get() = adult && agree && !busy && !tooYoung
}

sealed interface ConsentEvent {
    data class Adult(
        val checked: Boolean,
    ) : ConsentEvent

    data class Agree(
        val checked: Boolean,
    ) : ConsentEvent

    data object Accept : ConsentEvent
}

@HiltViewModel
class ConsentViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val data: ConsentDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow(ConsentUiState(track = savedStateHandle.get<String>("track").orEmpty()))
        val state: StateFlow<ConsentUiState> = _state.asStateFlow()

        init {
            viewModelScope.launch {
                val ok = runCatching { data.eligible() }.getOrDefault(true)
                _state.update { it.copy(tooYoung = !ok) }
            }
        }

        fun onEvent(event: ConsentEvent) {
            when (event) {
                is ConsentEvent.Adult -> _state.update { it.copy(adult = event.checked, error = false) }
                is ConsentEvent.Agree -> _state.update { it.copy(agree = event.checked, error = false) }
                ConsentEvent.Accept -> accept()
            }
        }

        private fun accept() {
            if (!_state.value.canAccept) return
            _state.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    data.accept(Consent.VERSION)
                    _state.update { it.copy(busy = false, done = true) }
                } catch (e: Exception) {
                    _state.update { it.copy(busy = false, error = true) }
                }
            }
        }
    }

@Composable
fun ConsentRoute(
    onAccepted: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: ConsentViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.done) { if (state.done) onAccepted(state.track) }
    ConsentScreen(state = state, onEvent = viewModel::onEvent, onBack = onBack)
}

/** Plain-language consent for the Arabic trial (Trial_App_Spec §11). Draft text: review against UU PDP before the closed test. */
@Composable
fun ConsentScreen(
    state: ConsentUiState,
    onEvent: (ConsentEvent) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    val email = stringResource(R.string.contact_email)
    Column(modifier = modifier.fillMaxSize().safeDrawingPadding()) {
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
        ) {
            // The course this consent is for, as its cover (the Arabic trial), above the words.
            ArtWithFallback("cover_lang_arab", contentDescription = null, modifier = Modifier.width(COURSE_COVER))
            Text(
                stringResource(R.string.consent_title),
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            Text(stringResource(R.string.consent_intro), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
            listOf(
                R.string.consent_what_title to stringResource(if (BuildConfig.NORMAL_AUTH_APPROVED) R.string.consent_what_body_cloud else R.string.consent_what_body),
                R.string.consent_where_title to stringResource(if (BuildConfig.NORMAL_AUTH_APPROVED) R.string.consent_where_body_cloud else R.string.consent_where_body),
                R.string.consent_why_title to stringResource(R.string.consent_why_body),
                R.string.consent_keep_title to stringResource(R.string.consent_keep_body),
                R.string.consent_stop_title to stringResource(R.string.consent_stop_body, email),
            ).forEach { (title, body) ->
                PaperCard {
                    Text(stringResource(title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
                    Text(body, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                }
            }
            if (state.tooYoung) {
                PaperCard(edge = colors.ochre) {
                    Text(stringResource(R.string.consent_too_young), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                }
            }
            CheckRow(checked = state.adult, label = stringResource(R.string.consent_check_adult), enabled = !state.busy && !state.tooYoung) {
                onEvent(ConsentEvent.Adult(it))
            }
            CheckRow(checked = state.agree, label = stringResource(R.string.consent_check_agree), enabled = !state.busy && !state.tooYoung) {
                onEvent(ConsentEvent.Agree(it))
            }
            if (state.error) Text(stringResource(R.string.consent_error), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
            Text(stringResource(R.string.consent_version_note, Consent.VERSION), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
        }
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.md),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm),
        ) {
            AyaButton(
                text = stringResource(R.string.consent_accept),
                onClick = { onEvent(ConsentEvent.Accept) },
                enabled = state.canAccept,
                modifier = Modifier.fillMaxWidth(),
            )
            AyaSecondaryButton(text = stringResource(R.string.action_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
        }
    }
}

private val COURSE_COVER = 120.dp

/** A whole-row checkbox (the row is the touch target, ≥ 48 dp, announced as a checkbox). */
@Composable
private fun CheckRow(
    checked: Boolean,
    label: String,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = AyaSpacing.touch)
                .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = CheckboxDefaults.colors(checkedColor = colors.accent, uncheckedColor = colors.inkSoft, checkmarkColor = colors.paper),
        )
        Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.padding(start = AyaSpacing.sm))
    }
}

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun ConsentPreview() {
    AyaTheme { PaperBackground { ConsentScreen(state = ConsentUiState(track = "arab", adult = true), onEvent = {}, onBack = {}) } }
}
