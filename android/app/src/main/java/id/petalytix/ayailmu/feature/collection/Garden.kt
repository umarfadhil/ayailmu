package id.petalytix.ayailmu.feature.collection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.theme.AyaTheme

/**
 * The garden for one track: each unit's sticker grows on its plot once earned; until then the plot shows a
 * seed. Described in words for TalkBack (how many plots have grown, and which).
 */
@Composable
fun GardenScene(
    stickers: List<StickerUi>,
    modifier: Modifier = Modifier,
) {
    val shown = stickers.take(GardenLayout.MAX_PLOTS)
    val plots = GardenLayout.plotsFor(shown.size)
    val grown = shown.filter { it.earned }
    val cd =
        buildString {
            append(stringResource(R.string.garden_cd, grown.size, shown.size))
            if (grown.isNotEmpty()) append(' ').append(stringResource(R.string.garden_cd_grown, grown.joinToString(", ") { it.unitTitle }))
        }
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .aspectRatio(GardenLayout.WIDTH.toFloat() / GardenLayout.HEIGHT)
                .clearAndSetSemantics { contentDescription = cd },
    ) {
        ArtImage(GardenLayout.SCENE, contentDescription = null, modifier = Modifier.fillMaxSize())
        plots.zip(shown).forEach { (p, st) ->
            Box(
                modifier = Modifier.offset(x = maxWidth * p.x, y = maxHeight * p.y).size(width = maxWidth * p.w, height = maxHeight * p.h),
                contentAlignment = Alignment.Center,
            ) {
                ArtImage(if (st.earned) st.key else GardenLayout.SEED, contentDescription = null, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Preview(name = "garden · id", showBackground = true, locale = "id")
@Preview(name = "garden · en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun GardenPreview() {
    AyaTheme {
        PaperBackground {
            GardenScene(
                listOf(
                    StickerUi("01", "Benda di sekitar kita", "sticker_kite", earned = true),
                    StickerUi("02", "Tubuhku", "sticker_cat", earned = true),
                    StickerUi("03", "Cuaca", "sticker_umbrella", earned = false),
                    StickerUi("04", "Tumbuhan", "sticker_leaf", earned = false),
                ),
            )
        }
    }
}
