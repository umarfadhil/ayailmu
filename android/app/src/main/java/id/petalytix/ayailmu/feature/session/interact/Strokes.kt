package id.petalytix.ayailmu.feature.session.interact

import androidx.compose.runtime.staticCompositionLocalOf
import id.petalytix.ayailmu.core.content.StrokeIndex

/**
 * Stroke data for `trace` items (`assets/strokes/index.json`, docs/content/INTERACTIONS_AUDIO.md §4). Provided once
 * at the app root (MainActivity); empty in previews and tests, where a trace item shows its glyph without guides.
 */
val LocalStrokes = staticCompositionLocalOf { StrokeIndex() }
