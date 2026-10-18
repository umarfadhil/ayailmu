package id.petalytix.ayailmu.feature.collection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.art.NotYetEarnedFilter
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import id.petalytix.ayailmu.feature.session.PictureMessage
import id.petalytix.ayailmu.feature.store.coverKey

@Composable
fun GemBoxRoute(
    onBack: () -> Unit,
    viewModel: GemBoxViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    GemBoxScreen(state = state, onBack = onBack)
}

@Composable
fun StickerShelfRoute(
    onBack: () -> Unit,
    viewModel: StickerShelfViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    StickerShelfScreen(state = state, onBack = onBack)
}

@Composable
private fun CollectionPage(
    title: String,
    onBack: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        Text(title, style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        content()
    }
}

/** «Kotak Permata»: every gem met in a session, with its source. Read again any time; nothing to "complete". */
@Composable
fun GemBoxScreen(
    state: CollectionUiState<List<GemUi>>,
    onBack: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    CollectionPage(stringResource(R.string.gems_title), onBack) {
        Column(verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            when (state) {
                CollectionUiState.Loading -> Unit
                CollectionUiState.Failed -> PictureMessage("state_error", stringResource(R.string.collection_failed), null)
                is CollectionUiState.Ready ->
                    if (state.value.isEmpty()) {
                        PictureMessage("gem_box", stringResource(R.string.gems_empty_title), stringResource(R.string.gems_empty_body))
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
                            ArtImage("gem_box", contentDescription = null, modifier = Modifier.width(72.dp))
                            Text(stringResource(R.string.gems_count, state.value.size), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
                        }
                        state.value.forEach { g ->
                            PaperCard(edge = colors.ochre) {
                                Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalAlignment = Alignment.Top) {
                                    ArtImage("gem", contentDescription = null, modifier = Modifier.size(28.dp))
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                                        Text(g.subjectTitle, style = MaterialTheme.typography.labelLarge, color = colors.accentDeep)
                                        Text(g.text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                                        g.source?.let { Text(stringResource(R.string.gems_source, it), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft) }
                                    }
                                }
                            }
                        }
                    }
            }
        }
    }
}

/** «Rak Stiker»: one sticker per unit, earned by finishing the unit challenge. Not-yet stickers are faint, never locked-looking. */
@Composable
fun StickerShelfScreen(
    state: CollectionUiState<List<StickerShelf>>,
    onBack: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    CollectionPage(stringResource(R.string.stickers_title), onBack) {
        Column(verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            when (state) {
                CollectionUiState.Loading -> Unit
                CollectionUiState.Failed -> PictureMessage("state_error", stringResource(R.string.collection_failed), null)
                is CollectionUiState.Ready ->
                    if (state.value.isEmpty()) {
                        PictureMessage("state_seedling", stringResource(R.string.stickers_empty_title), stringResource(R.string.stickers_empty_body))
                    } else {
                        Text(stringResource(R.string.stickers_body), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
                        state.value.forEach { shelf -> ShelfCard(shelf) }
                    }
            }
        }
    }
}

@Composable
private fun ShelfCard(shelf: StickerShelf) {
    val colors = AyaThemeTokens.colors
    PaperCard {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            shelf.subject?.let { ArtWithFallback(it.coverKey(), contentDescription = null, modifier = Modifier.width(SHELF_COVER)) }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                Text(
                    shelf.trackTitle,
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.ink,
                    modifier = Modifier.headingSemantics(),
                )
                Text(
                    stringResource(R.string.stickers_count, shelf.stickers.count { it.earned }, shelf.stickers.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.inkSoft,
                )
            }
        }
        if (shelf.garden) GardenScene(shelf.stickers)
        shelf.stickers.chunked(COLUMNS).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm)) {
                row.forEach { st ->
                    val cd =
                        if (st.earned) {
                            stringResource(R.string.stickers_cd_earned, st.unitTitle)
                        } else {
                            stringResource(R.string.stickers_cd_not_yet, st.unitTitle)
                        }
                    Column(
                        modifier = Modifier.weight(1f).clearAndSetSemantics { contentDescription = cd },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            ArtImage(
                                key = st.key,
                                contentDescription = null,
                                modifier = Modifier.fillMaxWidth(),
                                alpha = if (st.earned) 1f else 0.28f,
                                colorFilter = if (st.earned) null else NotYetEarnedFilter,
                            )
                        }
                        Text(
                            st.unitTitle,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (st.earned) colors.ink else colors.inkSoft,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                        )
                    }
                }
                repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

private const val COLUMNS = 3
private val SHELF_COVER = 64.dp

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun StickerShelfPreview() {
    AyaTheme {
        PaperBackground {
            StickerShelfScreen(
                state =
                    CollectionUiState.Ready(
                        listOf(
                            StickerShelf(
                                "Matematika — Pemula (Anak)",
                                listOf(
                                    StickerUi("01", "Bilangan sampai 100", "sticker_mango", earned = true),
                                    StickerUi("02", "Penjumlahan", "sticker_kite", earned = false),
                                    StickerUi("03", "Bangun datar", "sticker_angklung", earned = false),
                                    StickerUi("04", "Pengukuran", "sticker_bicycle", earned = false),
                                ),
                            ),
                        ),
                    ),
                onBack = {},
            )
        }
    }
}

@Preview(name = "gems · id", showBackground = true, locale = "id")
@Composable
private fun GemBoxPreview() {
    AyaTheme {
        PaperBackground {
            GemBoxScreen(
                state =
                    CollectionUiState.Ready(
                        listOf(GemUi("MAT-K-P-01-GEM", "Angka nol dipakai di India sejak berabad-abad lalu.", "Ensiklopedia Britannica: zero", "Matematika")),
                    ),
                onBack = {},
            )
        }
    }
}
