package id.petalytix.ayailmu.feature.units

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.NotYetEarnedFilter
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.SessionProgressBar
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.Sfx
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import id.petalytix.ayailmu.feature.session.AnswerDraft
import id.petalytix.ayailmu.feature.session.FeedbackCard
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.session.QuestionBlock
import id.petalytix.ayailmu.feature.store.coverKey
import id.petalytix.ayailmu.feature.store.productTitle

/** Where the Units screen can send the learner. */
data class UnitsNav(
    val back: () -> Unit = {},
    val preview: (String) -> Unit = {},
    val challenge: (String) -> Unit = {},
    val store: () -> Unit = {},
)

@Composable
fun UnitsRoute(
    nav: UnitsNav,
    viewModel: UnitsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Back from a challenge or the store: recompute (a sticker earned, a pack bought).
    var entered by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        if (entered) viewModel.refresh() else entered = true
    }
    UnitsScreen(state = state, nav = nav)
}

/** Every unit of one track, open or not (MONETIZATION_SCHEME: show what a pack adds, never hide it). */
@Composable
fun UnitsScreen(
    state: UnitsUiState,
    nav: UnitsNav,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = nav.back) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        Text(stringResource(R.string.units_title), style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        when (state) {
            UnitsUiState.Loading -> Unit
            UnitsUiState.Failed -> PictureMessage("state_error", stringResource(R.string.units_failed), null)
            is UnitsUiState.Ready -> {
                val d = state.data
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                    ArtWithFallback(d.subject.coverKey(), contentDescription = null, modifier = Modifier.width(COVER))
                    Text(d.trackTitle, style = MaterialTheme.typography.titleLarge, color = colors.inkSoft, modifier = Modifier.weight(1f))
                }
                Text(stringResource(R.string.units_intro), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                d.rows.forEach { row -> UnitCard(row, d.subject, d.lockedBy, nav) }
                d.lockedBy?.let { AyaSecondaryButton(text = stringResource(R.string.home_track_see_packs), onClick = nav.store, modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UnitCard(
    row: UnitRow,
    subject: Subject,
    lockedBy: Product?,
    nav: UnitsNav,
) {
    val colors = AyaThemeTokens.colors
    PaperCard(edge = if (row.challengeDone) colors.correct else null) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            // Every unit has a picture (MODULES_LEVELS_STORIES.md section 8): its sticker, faint until earned; a unit
            // without one (the Arabic course) shows its module's cover instead of a bare "Unit A" line.
            val sticker = row.sticker
            if (sticker != null) {
                ArtImage(
                    key = sticker,
                    contentDescription = null,
                    modifier = Modifier.size(STICKER),
                    alpha = if (row.challengeDone) 1f else 0.28f,
                    colorFilter = if (row.challengeDone) null else NotYetEarnedFilter,
                )
            } else {
                ArtWithFallback(subject.coverKey(), contentDescription = null, modifier = Modifier.width(STICKER))
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xxs)) {
                Text(stringResource(R.string.units_unit_label, row.unit), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
                row.title?.let { Text(it, style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics()) }
            }
        }
        val line = MaterialTheme.typography.bodyMedium
        when {
            row.locked -> lockedBy?.let { Text(stringResource(R.string.units_locked, stringResource(productTitle(it))), style = line, color = colors.ink) }
            else -> Text(stringResource(R.string.units_answered, row.answered, row.total), style = line, color = colors.ink)
        }
        if (row.challengeDone) Text(stringResource(R.string.units_challenge_done), style = line, color = colors.correct)
        if (row.challengeReady) Text(stringResource(R.string.units_challenge_ready), style = line, color = colors.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
            if (row.locked) AyaSecondaryButton(text = stringResource(R.string.units_try_one), onClick = { nav.preview(row.unit) })
            if (row.challengeReady) AyaButton(text = stringResource(R.string.units_challenge_start), onClick = { nav.challenge(row.unit) })
        }
    }
}

// ---- «Coba satu soal» ------------------------------------------------------------------------------

@Composable
fun UnitPreviewRoute(
    onBack: () -> Unit,
    onStore: () -> Unit,
    viewModel: UnitPreviewViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    UnitPreviewScreen(state = state, onAnswer = viewModel::answer, onBack = onBack, onStore = onStore)
}

/** One question, scored like a session but never saved; then the way to the pack, without pressure. */
@Composable
fun UnitPreviewScreen(
    state: UnitPreviewUiState,
    onAnswer: (Response) -> Unit,
    onBack: () -> Unit,
    onStore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        Text(stringResource(R.string.units_try_one), style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        when (state) {
            UnitPreviewUiState.Loading -> Unit
            UnitPreviewUiState.None -> PictureMessage("state_seedling", stringResource(R.string.preview_none_title), stringResource(R.string.preview_none_body))
            is UnitPreviewUiState.Ready -> {
                UnitHeading(state.unit, state.unitTitle)
                state.lockedBy?.let {
                    Text(stringResource(R.string.units_locked, stringResource(productTitle(it))), style = MaterialTheme.typography.bodyMedium, color = colors.ink)
                }
                PlayBlock(state.play, onAnswer)
                Text(stringResource(R.string.preview_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                if (state.play.feedback != null) {
                    if (state.lockedBy != null) AyaButton(text = stringResource(R.string.home_track_see_packs), onClick = onStore, modifier = Modifier.fillMaxWidth())
                    AyaSecondaryButton(text = stringResource(R.string.units_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

// ---- unit challenge --------------------------------------------------------------------------------

@Composable
fun UnitChallengeRoute(
    onBack: () -> Unit,
    viewModel: UnitChallengeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    UnitChallengeScreen(state = state, onAnswer = viewModel::answer, onNext = viewModel::next, onBack = onBack)
}

/** Five familiar questions, no timer, no pass mark. Finishing (whatever the answers) earns the sticker. */
@Composable
fun UnitChallengeScreen(
    state: ChallengeUiState,
    onAnswer: (Response) -> Unit,
    onNext: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        if (state !is ChallengeUiState.Done) TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        Text(stringResource(R.string.challenge_title), style = MaterialTheme.typography.headlineMedium, color = colors.ink, modifier = Modifier.headingSemantics())
        when (state) {
            ChallengeUiState.Loading -> Unit
            ChallengeUiState.NotReady -> {
                PictureMessage("state_seedling", stringResource(R.string.challenge_not_ready_title), stringResource(R.string.challenge_not_ready_body))
                AyaButton(text = stringResource(R.string.units_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
            }
            is ChallengeUiState.Running -> {
                UnitHeading(state.unit, state.unitTitle)
                val position = stringResource(R.string.challenge_position, state.position, state.total)
                SessionProgressBar(progress = (state.position - 1).toFloat() / state.total.coerceAtLeast(1), contentDescription = position)
                Text(position, style = MaterialTheme.typography.labelLarge, color = colors.inkSoft)
                key(state.position) { PlayBlock(state.play, onAnswer) }
                if (state.play.feedback != null) {
                    AyaButton(text = stringResource(R.string.action_continue), onClick = onNext, modifier = Modifier.fillMaxWidth())
                } else if (state.position == 1) {
                    Text(stringResource(R.string.challenge_note), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                }
            }
            is ChallengeUiState.Done -> {
                StickerSound(state)
                UnitHeading(state.unit, state.unitTitle)
                state.sticker?.let {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        ArtImage(it, contentDescription = null, modifier = Modifier.width(DONE_STICKER))
                    }
                }
                Text(stringResource(R.string.challenge_done_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
                Text(
                    stringResource(if (state.sticker != null) R.string.challenge_done_sticker else R.string.challenge_done_plain),
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.ink,
                )
                if (state.saveFailed) Text(stringResource(R.string.challenge_save_failed), style = MaterialTheme.typography.bodyMedium, color = colors.notYet)
                AyaButton(text = stringResource(R.string.units_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The sticker sound (INTERACTIONS_AUDIO.md §3.2), once, when the finished challenge is recorded and so the sticker is
 * earned. rememberSaveable keeps a rotation from playing it again; a unit without a sticker stays quiet.
 */
@Composable
private fun StickerSound(state: ChallengeUiState.Done) {
    val sound = LocalSoundFx.current
    var chimed by rememberSaveable(state.unit) { mutableStateOf(false) }
    LaunchedEffect(state.saved) {
        if (state.saved && state.sticker != null && !chimed) {
            chimed = true
            sound.play(Sfx.STICKER)
        }
    }
}

// ---- shared pieces ---------------------------------------------------------------------------------

@Composable
private fun UnitHeading(
    unit: String,
    title: String?,
) {
    val colors = AyaThemeTokens.colors
    Text(stringResource(R.string.units_unit_label, unit), style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
    title?.let { Text(it, style = MaterialTheme.typography.titleLarge, color = colors.ink) }
}

/** The question, then "Check" and "I don't know yet" (always allowed); after an answer, the feedback card. */
@Composable
private fun ColumnScope.PlayBlock(
    play: PlayQuestion,
    onAnswer: (Response) -> Unit,
) {
    val draft = remember(play.question.itemId) { AnswerDraft() }
    val feedback = play.feedback
    QuestionBlock(q = play.question, draft = draft, enabled = feedback == null, outcome = feedback?.outcome, ts = play.ts, onSubmit = onAnswer)
    if (feedback == null) {
        val response = draft.toResponse(play.question)
        AyaButton(text = stringResource(R.string.session_check), enabled = response != null, onClick = { response?.let(onAnswer) }, modifier = Modifier.fillMaxWidth())
        AyaSecondaryButton(text = stringResource(R.string.session_dont_know), onClick = { onAnswer(Response.dontKnow()) }, modifier = Modifier.fillMaxWidth())
    } else {
        FeedbackCard(feedback.outcome, feedback.messages)
    }
}

private val COVER = 72.dp
private val STICKER = 56.dp
private val DONE_STICKER = 160.dp

@Preview(name = "units · id", showBackground = true, locale = "id")
@Preview(name = "units · en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "units · id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun UnitsPreview() {
    AyaTheme {
        PaperBackground {
            UnitsScreen(
                state =
                    UnitsUiState.Ready(
                        UnitsData(
                            trackTitle = "Sains — Pemula (Anak)",
                            subject = Subject.SAINS,
                            rows =
                                listOf(
                                    UnitRow("01", "Benda di sekitar kita", "sticker_kite", locked = false, answered = 12, total = 12, challengeDone = true),
                                    UnitRow("02", "Tubuhku", "sticker_cat", locked = false, answered = 12, total = 12, challengeDone = false),
                                    UnitRow("03", "Cuaca", "sticker_umbrella", locked = true, answered = 0, total = 11, challengeDone = false),
                                ),
                            lockedBy = Product.PACK_SAINS,
                        ),
                    ),
                nav = UnitsNav(),
            )
        }
    }
}
