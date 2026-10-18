package id.petalytix.ayailmu.feature.collection

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.NotYetEarnedFilter
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.session.story.PreviewStory
import id.petalytix.ayailmu.feature.session.story.StoryDialog

/** «Tokoh Sejarah»: every figure whose story this profile has seen; tap one to watch the story again. */
@Composable
fun FiguresRoute(onBack: () -> Unit) {
    val viewModel: FiguresViewModel = hiltViewModel()
    val state by viewModel.state.collectAsStateWithLifecycle()
    FiguresScreen(state = state, onBack = onBack)
}

/**
 * Stateless gallery (CR-KT-3). Met figures: their emblem in colour and their name; tapping opens the story in the
 * player dialog. Not met yet: a faint emblem with «Belum bertemu», never locked-looking and never a score.
 */
@Composable
fun FiguresScreen(
    state: FiguresUiState,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    var playing by rememberSaveable { mutableStateOf<String?>(null) }
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack, modifier = Modifier.heightIn(min = AyaSpacing.touch)) {
            Text(stringResource(R.string.action_back), color = colors.accentDeep)
        }
        Text(
            stringResource(R.string.figures_title),
            style = MaterialTheme.typography.displaySmall,
            color = colors.ink,
            modifier = Modifier.headingSemantics(),
        )
        when (state) {
            FiguresUiState.Loading -> Unit
            FiguresUiState.Failed -> PictureMessage("state_error", stringResource(R.string.collection_failed), null)
            is FiguresUiState.Ready ->
                if (state.figures.isEmpty()) {
                    PictureMessage(EMPTY_ART, stringResource(R.string.figures_empty_title), stringResource(R.string.figures_empty_body))
                } else {
                    Text(stringResource(R.string.figures_body), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
                    Text(
                        stringResource(R.string.figures_count, state.met, state.figures.size),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.accentDeep,
                    )
                    state.figures.chunked(COLUMNS).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                            row.forEach { f -> FigureCard(f, onOpen = { playing = f.storyId }, modifier = Modifier.weight(1f)) }
                            repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
        }
    }
    val open = (state as? FiguresUiState.Ready)?.figures?.firstOrNull { it.storyId == playing && it.met }
    if (open != null) StoryDialog(open.story, onClose = { playing = null })
}

@Composable
private fun FigureCard(
    f: FigureUi,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    // One TalkBack stop per card: "<name>, <years>" with "double-tap to watch the story", or "<name>, Belum bertemu".
    val watch = stringResource(R.string.figures_watch)
    val tap =
        if (f.met) {
            Modifier.clickable(onClickLabel = watch, role = Role.Button, onClick = onOpen)
        } else {
            Modifier.semantics(mergeDescendants = true) {}
        }
    PaperCard(modifier = modifier.clip(AyaRadius.lg).then(tap).heightIn(min = AyaSpacing.touch)) {
        f.art?.let { key ->
            ArtImage(
                key = key,
                contentDescription = null,
                modifier = Modifier.fillMaxWidth(),
                alpha = if (f.met) 1f else NOT_MET_ALPHA,
                colorFilter = if (f.met) null else NotYetEarnedFilter,
            )
        }
        Text(
            f.name,
            style = MaterialTheme.typography.labelLarge,
            color = if (f.met) colors.ink else colors.inkSoft,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        val second = if (f.met) f.years else stringResource(R.string.figures_not_met)
        second?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = colors.inkSoft,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private const val COLUMNS = 2
private const val NOT_MET_ALPHA = 0.28f

/** Empty state: the Sejarah cover (draft art; a key with no drawing yet simply leaves the space). */
private const val EMPTY_ART = "cover_sejarah"

// ---- previews -------------------------------------------------------------------------------------------------

private val previewFigures =
    listOf(
        FigureUi(PreviewStory, met = true),
        FigureUi(
            PreviewStory.copy(storyId = "ST-KI-HAJAR", figure = "Ki Hajar Dewantara (1889–1959)", emblem = "hist_ki_hajar_school"),
            met = false,
        ),
        FigureUi(PreviewStory.copy(storyId = "ST-ZHENG-HE", figure = "Zheng He (1371–1433)", emblem = "hist_treasure_ship"), met = true),
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "id · fontScale 1.5", showBackground = true, locale = "id", fontScale = 1.5f)
@Composable
private fun FiguresPreview() {
    AyaTheme { PaperBackground { FiguresScreen(state = FiguresUiState.Ready(previewFigures), onBack = {}) } }
}

@Preview(name = "empty · id", showBackground = true, locale = "id")
@Composable
private fun FiguresEmptyPreview() {
    AyaTheme { PaperBackground { FiguresScreen(state = FiguresUiState.Ready(emptyList()), onBack = {}) } }
}
