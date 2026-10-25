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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.AyaFigure
import id.petalytix.ayailmu.core.design.art.AyaPose
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
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.modules.ArtBadge
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import id.petalytix.ayailmu.feature.modules.ModuleCard
import id.petalytix.ayailmu.feature.modules.ModuleLanguage
import id.petalytix.ayailmu.feature.modules.PictureButton
import id.petalytix.ayailmu.feature.modules.artKey
import id.petalytix.ayailmu.feature.modules.languageName
import id.petalytix.ayailmu.feature.modules.levelName
import id.petalytix.ayailmu.feature.modules.moduleName
import id.petalytix.ayailmu.feature.store.coverKey
import id.petalytix.ayailmu.feature.store.productTitle
import id.petalytix.ayailmu.feature.trial.SurveyKind
import kotlinx.coroutines.delay

/** Where Home can send the learner; the nav graph decides how (e.g. consent before an evidence track). */
data class HomeNav(
    /** «Mulai» / «Lanjutkan» on a module card: today's session on the module's chosen track. */
    val startModule: (ModuleCard) -> Unit = {},
    /** «Ganti» on a module card: the module screen (language, level, units, progress). */
    val openModule: (Subject) -> Unit = {},
    val openSettings: () -> Unit = {},
    val addProfile: () -> Unit = {},
    val openStore: () -> Unit = {},
    val openPuzzle: () -> Unit = {},
    val openGems: () -> Unit = {},
    val openStickers: () -> Unit = {},
    val openSurvey: (SurveyCard) -> Unit = {},
)

@Composable
fun HomeRoute(
    nav: HomeNav,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Saved with the back-stack entry: false on first open (the ViewModel loads anyway), true when coming back
    // from a session, a module or settings, which is when "Resume", a choice or the profile may have changed.
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        if (entered) viewModel.onEvent(HomeEvent.Refresh) else entered = true
    }
    HomeScreen(state = state, onEvent = viewModel::onEvent, nav = nav)
}

/** Stateless screen (CR-KT-3): profile header, one card per module, collections, developer check (demo only). */
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
                avatars = home?.avatars.orEmpty(),
                busy = state.busy,
                onSwitch = { onEvent(HomeEvent.SwitchProfile(it)) },
                nav = nav,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
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
                }
                // Aya bobs gently on twos; with animations off she stands still (ART_DIRECTION section 2.7).
                AyaFigure(pose = AyaPose.IDLE, contentDescription = stringResource(R.string.cd_aya_mascot), size = AYA_HOME, float = true)
            }
            if (state.actionFailed) Text(stringResource(R.string.dev_notice_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
            home?.survey?.let { SurveyCardView(it, busy = state.busy, onOpen = { nav.openSurvey(it) }, onLater = { onEvent(HomeEvent.SnoozeSurvey) }) }
            home?.puzzle?.let { PuzzleCardView(it, nav.openPuzzle) }
            Spacer(Modifier.height(AyaSpacing.xs))
            Text(
                text = stringResource(R.string.home_tracks_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            when {
                home == null -> Unit
                home.loadError -> PictureNote("state_error", stringResource(R.string.home_load_error))
                home.modules.isEmpty() ->
                    PictureNote(
                        "state_seedling",
                        stringResource(if (state.developerDemo) R.string.home_no_tracks else R.string.home_no_content_prod),
                    )
                else -> {
                    home.modules.forEach { card ->
                        ModuleCardView(
                            card = card,
                            showDraft = state.developerDemo,
                            onStart = { nav.startModule(card) },
                            onChange = { nav.openModule(card.subject) },
                            onStore = nav.openStore,
                        )
                    }
                    CollectionsRow(nav)
                }
            }
            if (state.developerDemo) {
                Spacer(Modifier.height(AyaSpacing.sm))
                DevCheckCard(state = state, onEvent = onEvent)
                Text(text = stringResource(R.string.home_phase_label), style = MaterialTheme.typography.labelSmall, color = colors.inkSoft)
            }
        }
    }
}

/** The profile's picture and name open the switcher (every profile with its picture); Settings sits beside it. */
@Composable
private fun ProfileHeader(
    profile: Profile?,
    profiles: List<Profile>,
    avatars: Map<String, String>,
    busy: Boolean,
    onSwitch: (String) -> Unit,
    nav: HomeNav,
) {
    val colors = AyaThemeTokens.colors
    var open by remember { mutableStateOf(false) }
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.weight(1f)) {
            TextButton(onClick = { open = true }, enabled = !busy) {
                if (profile != null) {
                    // The name is said right after; the picture itself stays silent for TalkBack.
                    ProfileAvatar(key = avatars[profile.id] ?: Avatars.defaultFor(profile.id), contentDescription = null)
                    Spacer(Modifier.width(AyaSpacing.sm))
                }
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
                        leadingIcon = {
                            ProfileAvatar(key = avatars[p.id] ?: Avatars.defaultFor(p.id), contentDescription = null, size = MENU_AVATAR)
                        },
                        text = {
                            Text(
                                text = stringResource(R.string.home_profile_button, p.label, kindLabel(p.kind)),
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

/**
 * One module (MODULES_LEVELS_STORIES.md section 1): its cover, its name, the chosen language and level as picture
 * badges, today's progress, «Mulai» for today's session on that track and «Ganti» for the module screen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ModuleCardView(
    card: ModuleCard,
    showDraft: Boolean,
    onStart: () -> Unit,
    onChange: () -> Unit,
    onStore: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val line = MaterialTheme.typography.bodyMedium
    PaperCard {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            ArtWithFallback(card.subject.coverKey(), contentDescription = null, modifier = Modifier.width(COVER_WIDTH))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                Text(
                    stringResource(moduleName(card.subject)),
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.ink,
                    modifier = Modifier.headingSemantics(),
                )
                ModuleBadges(card)
            }
        }
        Text(stringResource(R.string.module_today, card.todayAnswered), style = line, color = colors.ink)
        Text(stringResource(R.string.module_units_done, card.unitsDone, card.unitsTotal), style = line, color = colors.inkSoft)
        card.suggestion?.let {
            Text(stringResource(R.string.module_suggest_line, stringResource(levelName(it))), style = line, color = colors.ink)
        }
        if (showDraft && card.unreviewed) {
            Text(
                text = stringResource(R.string.home_track_draft),
                style = MaterialTheme.typography.labelSmall,
                color = colors.ink,
                modifier = Modifier.background(colors.ochre.copy(alpha = 0.35f), AyaRadius.sm).padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xxs),
            )
        }
        if (card.needsConsent) Text(stringResource(R.string.home_track_consent_first), style = line, color = colors.inkSoft)
        // Free tier: say plainly what is open and what the pack adds. No countdowns, no pressure (MONETIZATION_SCHEME).
        card.lockedBy?.let { product ->
            Text(
                stringResource(R.string.home_track_units_open, card.openUnits, card.unitsTotal, stringResource(productTitle(product))),
                style = line,
                color = colors.ink,
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            AyaButton(text = stringResource(if (card.resumable) R.string.home_track_resume else R.string.home_start), onClick = onStart)
            AyaSecondaryButton(text = stringResource(R.string.module_change), onClick = onChange)
            if (card.lockedBy != null) AyaSecondaryButton(text = stringResource(R.string.home_track_see_packs), onClick = onStore)
        }
    }
}

/** «Korea» and «Menengah» as picture badges, and «Gratis» on a free module (Nilai). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ModuleBadges(card: ModuleCard) {
    val colors = AyaThemeTokens.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.xs), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
        card.language?.let { lang ->
            val name = stringResource(languageName(lang))
            ArtBadge(art = lang.art, label = name, description = stringResource(R.string.module_cd_language, name))
        }
        val level = stringResource(levelName(card.level))
        ArtBadge(art = card.level.artKey(), label = level, description = stringResource(R.string.module_cd_level, level))
        if (card.free) {
            Text(
                text = stringResource(R.string.module_free),
                style = MaterialTheme.typography.labelLarge,
                color = colors.ink,
                modifier =
                    Modifier
                        .background(colors.sage.copy(alpha = 0.35f), AyaRadius.sm)
                        .padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xs),
            )
        }
    }
}

/** A short message with its picture (an empty shelf, a load error): never text alone (section 8). */
@Composable
private fun PictureNote(
    picture: String,
    text: String,
) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            ArtImage(picture, contentDescription = null, modifier = Modifier.width(AYA_SMALL))
            Text(text = text, style = MaterialTheme.typography.bodyMedium, color = colors.ink, modifier = Modifier.weight(1f))
        }
    }
}

/** P7 trial survey (day 7 / end of trial). Never blocking: "Nanti saja" hides it until tomorrow. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SurveyCardView(
    survey: SurveyCard,
    busy: Boolean,
    onOpen: () -> Unit,
    onLater: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard(edge = colors.accentDeep) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            ArtImage("state_survey", contentDescription = null, modifier = Modifier.width(AYA_SMALL))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                val (title, body) =
                    when (survey.kind) {
                        SurveyKind.BACKGROUND -> R.string.home_survey_title_background to R.string.home_survey_body_background
                        SurveyKind.DAY7 -> R.string.home_survey_title_day7 to R.string.home_survey_body
                        SurveyKind.END -> R.string.home_survey_title_end to R.string.home_survey_body
                    }
                Text(
                    stringResource(title),
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.ink,
                    modifier = Modifier.headingSemantics(),
                )
                Text(stringResource(body), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            AyaButton(text = stringResource(R.string.home_survey_open), enabled = !busy, onClick = onOpen)
            AyaSecondaryButton(text = stringResource(R.string.survey_later), enabled = !busy, onClick = onLater)
        }
    }
}

/** Today's puzzle: one small card, gone quiet once answered. */
@Composable
private fun PuzzleCardView(
    puzzle: PuzzleCard,
    onOpen: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard(edge = colors.ochre) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            AyaFigure(pose = if (puzzle.done) AyaPose.HAPPY else AyaPose.THINK, contentDescription = null, size = AYA_SMALL)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                Text(stringResource(R.string.puzzle_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
                Text(
                    if (puzzle.done) stringResource(R.string.home_puzzle_done) else stringResource(R.string.home_puzzle_from, puzzle.subjectTitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.inkSoft,
                )
            }
        }
        if (!puzzle.done) AyaSecondaryButton(text = stringResource(R.string.home_puzzle_open), onClick = onOpen, modifier = Modifier.fillMaxWidth())
    }
}

/** The two collections as picture buttons (the gem box, a sticker), each with its name. */
@Composable
private fun CollectionsRow(nav: HomeNav) {
    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), modifier = Modifier.fillMaxWidth()) {
        PictureButton("gem_box", stringResource(R.string.gems_title), nav.openGems, Modifier.weight(1f))
        PictureButton("sticker_star_fruit", stringResource(R.string.stickers_title), nav.openStickers, Modifier.weight(1f))
    }
}

private val COVER_WIDTH = 88.dp
private val AYA_HOME = 88.dp
private val AYA_SMALL = 56.dp
private val MENU_AVATAR = 32.dp

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
        // P5: the demo opens every unit; this shows the free tier exactly as prod would (locks, store, gate).
        TextButton(enabled = !state.busy, onClick = { onEvent(HomeEvent.SetFreeTier(!dc.freeTier)) }) {
            Text(stringResource(if (dc.freeTier) R.string.dev_free_tier_on else R.string.dev_free_tier_off))
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
                modules =
                    listOf(
                        ModuleCard(
                            subject = Subject.BAHASA,
                            language = ModuleLanguage.KOREA,
                            level = Level.MENENGAH,
                            track = "kor-a-m",
                            trackTitle = "Bahasa Korea — Menengah (Dewasa)",
                            todayAnswered = 6,
                            unitsDone = 1,
                            unitsTotal = 2,
                            resumable = true,
                            unreviewed = true,
                            openUnits = 1,
                            lockedBy = Product.PACK_BAHASA,
                        ),
                        ModuleCard(
                            subject = Subject.MATEMATIKA,
                            language = null,
                            level = Level.PEMULA,
                            track = "mat-a",
                            trackTitle = "Matematika — Pemula (Dewasa)",
                            unitsDone = 8,
                            unitsTotal = 10,
                            openUnits = 10,
                            suggestion = Level.MENENGAH,
                        ),
                        ModuleCard(
                            subject = Subject.NILAI,
                            language = null,
                            level = Level.PEMULA,
                            track = "nil-a",
                            trackTitle = "Nilai — Pemula (Dewasa)",
                            unitsTotal = 3,
                            openUnits = 3,
                            free = true,
                        ),
                    ),
                puzzle = PuzzleCard("mat-a", "MAT-A-P-DP-01", "Matematika — Pemula (Dewasa)", done = false),
                survey = SurveyCard("arab", SurveyKind.DAY7),
                avatars = mapOf("lrn-1" to "pic_rabbit"),
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
