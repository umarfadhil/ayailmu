package id.petalytix.ayailmu.feature.modules

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.ChoiceState
import id.petalytix.ayailmu.core.design.components.OptionCard
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Level
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.home.ModuleBadges
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.store.coverKey
import id.petalytix.ayailmu.feature.store.productTitle

/** Where the module screen can send the learner; the nav graph decides how (consent first for Arabic). */
data class ModuleNav(
    val back: () -> Unit = {},
    val start: (ModuleCard) -> Unit = {},
    val units: (String) -> Unit = {},
    val progress: (String) -> Unit = {},
    val store: () -> Unit = {},
    /** Sejarah only: «Galeri tokoh» (feature/collection, APP-STORY). */
    val figures: () -> Unit = {},
)

@Composable
fun ModuleRoute(
    nav: ModuleNav,
    viewModel: ModuleViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Back from a session, Units or Progress: recompute, so progress and «Lanjutkan» are current (as Home does).
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        if (entered) viewModel.onEvent(ModuleEvent.Refresh) else entered = true
    }
    ModuleScreen(state = state, onEvent = viewModel::onEvent, nav = nav)
}

/**
 * One module (MODULES_LEVELS_STORIES.md section 1): its cover, for Bahasa the language picker (one cover per
 * language), the level ladder (four badges with their progress; «Segera» where no track exists yet) and the chosen
 * track's way in. Any level may be chosen; the next one is suggested, never forced.
 */
@Composable
fun ModuleScreen(
    state: ModuleUiState,
    onEvent: (ModuleEvent) -> Unit,
    nav: ModuleNav,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = nav.back) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        when (state) {
            ModuleUiState.Loading -> Unit
            ModuleUiState.Failed -> PictureMessage("state_error", stringResource(R.string.module_failed), null)
            is ModuleUiState.Ready -> ModuleBody(state, onEvent, nav)
        }
    }
}

@Composable
private fun ColumnScope.ModuleBody(
    state: ModuleUiState.Ready,
    onEvent: (ModuleEvent) -> Unit,
    nav: ModuleNav,
) {
    val colors = AyaThemeTokens.colors
    val view = state.data.detail.view
    val card = state.data.detail.card
    Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
        ArtWithFallback(view.subject.coverKey(), contentDescription = null, modifier = Modifier.width(HEADER_COVER))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
            Text(
                stringResource(moduleName(view.subject)),
                style = MaterialTheme.typography.displaySmall,
                color = colors.ink,
                modifier = Modifier.headingSemantics(),
            )
            ModuleBadges(card)
        }
    }
    if (state.saveFailed) {
        Text(stringResource(R.string.settings_notice_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
    }
    if (view.languages.isNotEmpty()) {
        SectionTitle(stringResource(R.string.module_languages_title))
        LanguageRow(view.languages) { onEvent(ModuleEvent.PickLanguage(it)) }
    }
    SectionTitle(stringResource(R.string.module_levels_title))
    view.ladder.forEach { rung -> LevelCard(rung, state.data.audience) { onEvent(ModuleEvent.PickLevel(rung.level)) } }
    TrackCard(card, nav)
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = AyaThemeTokens.colors.ink, modifier = Modifier.headingSemantics())
}

/** One picture card per language (the script and an everyday object); the name sits small under it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LanguageRow(
    languages: List<LanguageOption>,
    onPick: (ModuleLanguage) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
        languages.forEach { option ->
            OptionCard(
                state = if (option.chosen) ChoiceState.SELECTED else ChoiceState.IDLE,
                onClick = { onPick(option.language) },
                compact = true,
                fillWidth = false,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                    ArtWithFallback(option.language.art, contentDescription = null, modifier = Modifier.width(LANGUAGE_COVER))
                    Text(
                        stringResource(languageName(option.language)),
                        style = MaterialTheme.typography.labelLarge,
                        color = AyaThemeTokens.colors.ink,
                    )
                }
            }
        }
    }
}

/** One level: its plant badge, name, what it means for this audience, its progress, or «Segera». */
@Composable
private fun LevelCard(
    rung: LevelRung,
    audience: Audience,
    onPick: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    OptionCard(
        state =
            when {
                rung.comingSoon -> ChoiceState.DIMMED
                rung.chosen -> ChoiceState.SELECTED
                else -> ChoiceState.IDLE
            },
        onClick = onPick,
        enabled = !rung.comingSoon,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            ArtWithFallback(rung.level.artKey(), contentDescription = null, modifier = Modifier.size(LEVEL_ART))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xxs)) {
                Text(stringResource(levelName(rung.level)), style = MaterialTheme.typography.titleMedium, color = colors.ink)
                Text(
                    stringResource(levelDescription(rung.level, audience)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.inkSoft,
                )
                if (rung.comingSoon) {
                    Text(stringResource(R.string.module_coming_soon), style = MaterialTheme.typography.labelLarge, color = colors.inkSoft)
                } else {
                    val progress = stringResource(R.string.module_level_progress, rung.unitsDone, rung.unitsTotal)
                    SessionProgressBar(
                        progress = if (rung.unitsTotal == 0) 0f else rung.unitsDone.toFloat() / rung.unitsTotal,
                        contentDescription = progress,
                    )
                    Text(progress, style = MaterialTheme.typography.labelMedium, color = colors.inkSoft)
                }
                if (rung.suggested) {
                    Text(
                        text = stringResource(R.string.module_suggest_badge),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.ink,
                        modifier =
                            Modifier
                                .background(colors.sage.copy(alpha = 0.35f), AyaRadius.sm)
                                .padding(horizontal = AyaSpacing.sm, vertical = AyaSpacing.xxs),
                    )
                }
            }
        }
    }
}

/** The chosen track: today's session, its units and its progress (and, for Sejarah, the figure gallery). */
@Composable
private fun TrackCard(
    card: ModuleCard,
    nav: ModuleNav,
) {
    val colors = AyaThemeTokens.colors
    val line = MaterialTheme.typography.bodyMedium
    PaperCard {
        Text(card.trackTitle, style = MaterialTheme.typography.titleMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(stringResource(R.string.module_today, card.todayAnswered), style = line, color = colors.ink)
        Text(stringResource(R.string.module_units_done, card.unitsDone, card.unitsTotal), style = line, color = colors.inkSoft)
        card.suggestion?.let {
            Text(stringResource(R.string.module_suggest_line, stringResource(levelName(it))), style = line, color = colors.ink)
        }
        if (card.needsConsent) Text(stringResource(R.string.home_track_consent_first), style = line, color = colors.inkSoft)
        card.lockedBy?.let { product ->
            Text(
                stringResource(R.string.home_track_units_open, card.openUnits, card.unitsTotal, stringResource(productTitle(product))),
                style = line,
                color = colors.ink,
            )
        }
        AyaButton(
            text = stringResource(if (card.resumable) R.string.home_track_resume else R.string.home_start),
            onClick = { nav.start(card) },
            modifier = Modifier.fillMaxWidth(),
        )
        val wide = Modifier.fillMaxWidth()
        AyaSecondaryButton(text = stringResource(R.string.home_track_units), onClick = { nav.units(card.track) }, modifier = wide)
        AyaSecondaryButton(text = stringResource(R.string.home_track_progress), onClick = { nav.progress(card.track) }, modifier = wide)
        if (card.lockedBy != null) {
            AyaSecondaryButton(text = stringResource(R.string.home_track_see_packs), onClick = nav.store, modifier = wide)
        }
    }
    if (card.subject == Subject.SEJARAH) {
        PictureButton("hist_book_stack", stringResource(R.string.module_figures), nav.figures, Modifier.fillMaxWidth(), FIGURES_ART)
    }
}

private val HEADER_COVER = 112.dp
private val LANGUAGE_COVER = 96.dp
private val LEVEL_ART = 64.dp
private val FIGURES_ART = 56.dp

private val previewModule =
    ModuleUiState.Ready(
        ModuleScreenData(
            detail =
                ModuleDetail(
                    view =
                        ModuleView(
                            subject = Subject.BAHASA,
                            languages =
                                listOf(
                                    LanguageOption(ModuleLanguage.ARAB, chosen = false),
                                    LanguageOption(ModuleLanguage.INGGRIS, chosen = false),
                                    LanguageOption(ModuleLanguage.KOREA, chosen = true),
                                ),
                            language = ModuleLanguage.KOREA,
                            ladder =
                                listOf(
                                    LevelRung(Level.PEMULA, "kor-a", unitsDone = 4, unitsTotal = 5),
                                    LevelRung(Level.MENENGAH, "kor-a-m", unitsDone = 0, unitsTotal = 2, chosen = true),
                                    LevelRung(Level.MAHIR, "kor-a-h", unitsDone = 0, unitsTotal = 2),
                                    LevelRung(Level.MASTER, null),
                                ),
                            level = Level.MENENGAH,
                            track = "kor-a-m",
                            suggestion = null,
                        ),
                    card =
                        ModuleCard(
                            subject = Subject.BAHASA,
                            language = ModuleLanguage.KOREA,
                            level = Level.MENENGAH,
                            track = "kor-a-m",
                            trackTitle = "Bahasa Korea — Menengah (Dewasa)",
                            todayAnswered = 3,
                            unitsTotal = 2,
                            openUnits = 1,
                            lockedBy = Product.PACK_BAHASA,
                        ),
                ),
            audience = Audience.ADULTS,
        ),
    )

@Preview(name = "id · light", showBackground = true, locale = "id", heightDp = 1600)
@Preview(
    name = "en · dark",
    showBackground = true,
    locale = "en",
    uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES,
    heightDp = 1600,
)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f, heightDp = 2200)
@Composable
private fun ModulePreview() {
    AyaTheme { PaperBackground { ModuleScreen(state = previewModule, onEvent = {}, nav = ModuleNav()) } }
}
