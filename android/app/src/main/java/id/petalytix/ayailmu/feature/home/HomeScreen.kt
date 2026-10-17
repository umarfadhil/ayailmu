package id.petalytix.ayailmu.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.delay

/** Where Home can send the learner; the nav graph decides how (e.g. consent before an evidence track). */
data class HomeNav(
    val openTrack: (TrackCard) -> Unit = {},
    val openProgress: (String) -> Unit = {},
    val openSettings: () -> Unit = {},
    val addProfile: () -> Unit = {},
)

@Composable
fun HomeRoute(
    nav: HomeNav,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Saved with the back-stack entry: false on first open (the ViewModel loads anyway), true when coming back
    // from a session or settings, which is when "Resume" or the profile may have changed.
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        if (entered) viewModel.onEvent(HomeEvent.Refresh) else entered = true
    }
    HomeScreen(state = state, onEvent = viewModel::onEvent, nav = nav)
}

/** Stateless screen (CR-KT-3): profile header, subject shelf, developer check (demo only). */
@Composable
fun HomeScreen(
    state: HomeUiState,
    onEvent: (HomeEvent) -> Unit,
    nav: HomeNav,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    val home = state.home
    LaunchedEffect(state.actionFailed) {
        if (state.actionFailed) {
            delay(4_000)
            onEvent(HomeEvent.NoticeShown)
        }
    }
    Column(modifier = modifier.fillMaxSize().safeDrawingPadding()) {
        if (state.developerDemo) {
            Text(
                text = stringResource(R.string.banner_developer_demo),
                style = MaterialTheme.typography.labelSmall,
                color = colors.paper,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .background(colors.slate)
                        .padding(horizontal = AyaSpacing.md, vertical = AyaSpacing.xs),
            )
        }
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
        ) {
            ProfileHeader(
                profile = home?.profile,
                profiles = home?.profiles.orEmpty(),
                busy = state.busy,
                onSwitch = { onEvent(HomeEvent.SwitchProfile(it)) },
                nav = nav,
            )
            Text(
                text = stringResource(R.string.home_title),
                style = MaterialTheme.typography.displaySmall,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            val name = home?.profile?.label
            Text(
                text = if (name != null) stringResource(R.string.home_greeting_name, name) else stringResource(R.string.home_greeting),
                style = MaterialTheme.typography.bodyLarge,
                color = colors.inkSoft,
            )
            if (state.actionFailed) Text(stringResource(R.string.dev_notice_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
            Spacer(Modifier.height(AyaSpacing.xs))
            Text(
                text = stringResource(R.string.home_tracks_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            when {
                home == null -> Unit
                home.loadError -> Text(stringResource(R.string.home_load_error), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
                home.tracks.isEmpty() ->
                    PaperCard {
                        Text(
                            text = stringResource(if (state.developerDemo) R.string.home_no_tracks else R.string.home_no_content_prod),
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.ink,
                        )
                    }
                else ->
                    home.tracks.forEach { card ->
                        TrackCardView(card = card, showDraft = state.developerDemo, onOpen = { nav.openTrack(card) }, onProgress = { nav.openProgress(card.track) })
                    }
            }
            if (state.developerDemo) {
                Spacer(Modifier.height(AyaSpacing.sm))
                DevCheckCard(state = state, onEvent = onEvent)
            }
            Text(text = stringResource(R.string.home_phase_label), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
        }
    }
}

/** The profile name opens the switcher; Settings sits beside it. */
@Composable
private fun ProfileHeader(
    profile: Profile?,
    profiles: List<Profile>,
    busy: Boolean,
    onSwitch: (String) -> Unit,
    nav: HomeNav,
) {
    val colors = AyaThemeTokens.colors
    var open by remember { mutableStateOf(false) }
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.weight(1f)) {
            TextButton(onClick = { open = true }, enabled = !busy) {
                Text(
                    text = profile?.let { stringResource(R.string.home_profile_button, it.label, kindLabel(it.kind)) } ?: stringResource(R.string.home_profile_switch),
                    color = colors.accentDeep,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                profiles.forEach { p ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = "${p.label} · ${kindLabel(p.kind)}",
                                color = if (p.id == profile?.id) colors.accentDeep else colors.ink,
                            )
                        },
                        onClick = {
                            open = false
                            if (p.id != profile?.id) onSwitch(p.id)
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.home_profile_add), color = colors.ink) },
                    onClick = {
                        open = false
                        nav.addProfile()
                    },
                )
            }
        }
        TextButton(onClick = nav.openSettings, enabled = !busy) {
            Text(stringResource(R.string.settings_title), color = colors.accentDeep)
        }
    }
}

@Composable
private fun kindLabel(kind: ProfileKind): String =
    stringResource(if (kind == ProfileKind.ANAK) R.string.home_profile_kind_child else R.string.home_profile_kind_adult)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrackCardView(
    card: TrackCard,
    showDraft: Boolean,
    onOpen: () -> Unit,
    onProgress: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        Text(card.title, style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(stringResource(R.string.home_track_items, card.items), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        if (showDraft && card.unreviewed) {
            Text(
                text = stringResource(R.string.home_track_draft),
                style = MaterialTheme.typography.labelSmall,
                color = colors.ink,
                modifier = Modifier.background(colors.ochre.copy(alpha = 0.35f), AyaRadius.sm).padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xxs),
            )
        }
        if (card.needsConsent) {
            Text(stringResource(R.string.home_track_consent_first), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            AyaButton(text = stringResource(if (card.resumable) R.string.home_track_resume else R.string.home_start), onClick = onOpen)
            AyaSecondaryButton(text = stringResource(R.string.home_track_progress), onClick = onProgress)
        }
    }
}

@Composable
private fun DevCheckCard(
    state: HomeUiState,
    onEvent: (HomeEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val dc = state.devCheck ?: DevCheck()
    val labelId = stringResource(R.string.dev_profile_label_id)
    val labelEn = stringResource(R.string.dev_profile_label_en)
    PaperCard {
        Text(text = stringResource(R.string.dev_check_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
        val line = MaterialTheme.typography.bodyMedium
        if (dc.loadError != null) {
            Text(text = stringResource(R.string.dev_check_load_error, dc.loadError), style = line, color = colors.notYet)
        } else {
            Text(text = stringResource(R.string.dev_check_packs, dc.tracks, dc.items, dc.problems), style = line, color = if (dc.problems == 0) colors.ink else colors.notYet)
        }
        Text(text = stringResource(R.string.dev_check_storage, dc.profiles, dc.answers), style = line, color = colors.ink)
        Text(
            text =
                if (dc.activeLabel != null) {
                    stringResource(R.string.dev_check_active, dc.activeLabel, dc.activeLang?.tag.orEmpty())
                } else {
                    stringResource(R.string.dev_check_no_active)
                },
            style = line,
            color = colors.inkSoft,
        )
        TextButton(enabled = !state.busy, onClick = { onEvent(HomeEvent.CreateTestProfile(labelId, Lang.ID)) }) {
            Text(stringResource(R.string.dev_create_profile_id))
        }
        TextButton(enabled = !state.busy, onClick = { onEvent(HomeEvent.CreateTestProfile(labelEn, Lang.EN)) }) {
            Text(stringResource(R.string.dev_create_profile_en))
        }
        Text(text = stringResource(R.string.dev_moved_note), style = line, color = colors.inkSoft)
    }
}

private val previewProfile =
    Profile(
        id = "lrn-1",
        label = "Umar",
        kind = ProfileKind.ADULT,
        createdBy = null,
        birthYear = 1990,
        audience = Audience.ADULTS,
        lang = Lang.ID,
        createdAtMs = 0L,
        sessionMinutes = null,
        arabicScale = 1f,
        screensSeen = emptyList(),
        consentVersion = null,
    )

internal val previewHomeState =
    HomeUiState(
        developerDemo = true,
        home =
            HomeData(
                profile = previewProfile,
                profiles = listOf(previewProfile),
                tracks = listOf(TrackCard("arab", "Bahasa Arab — Unit A (contoh pengembang)", 17, resumable = false, unreviewed = true, needsConsent = true)),
            ),
        devCheck = DevCheck(tracks = 2, items = 29, problems = 0, profiles = 1, answers = 0, activeLabel = "Umar", activeLang = Lang.ID),
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun HomeScreenPreview() {
    AyaTheme { PaperBackground { HomeScreen(state = previewHomeState, onEvent = {}, nav = HomeNav()) } }
}
