package id.petalytix.ayailmu.feature.session.story

import id.petalytix.ayailmu.core.content.Motion
import id.petalytix.ayailmu.core.content.Story
import id.petalytix.ayailmu.core.model.Lang

// The story a `story` item plays (docs/content/MODULES_LEVELS_STORIES.md section 2), resolved for one instruction
// language: what the player draws. Pure, no Android types; built once per step by StepMapper and by the figure
// gallery, so the session, the «Lihat cerita lagi» dialog and the gallery show exactly the same story.

/**
 * One picture layer: [x], [y] = top-left and [w] = width, as fractions of the 16:9 scene (height follows the
 * drawing's aspect, [StoryLayout]); [flip] mirrors it; [motion] is evaluated by [StoryMotion] (MotionMath).
 */
data class StoryLayerUi(
    val art: String,
    val x: Double,
    val y: Double,
    val w: Double,
    val flip: Boolean = false,
    val motion: Motion? = null,
)

/**
 * One panel: the background [scene] (art key), its [layers] already in drawing order, the [caption] in the
 * profile's language (always shown), the [narration] clip for that language (null = caption only) and the
 * optional slow push-in on the whole scene ([zoom], typed as a zoom motion).
 */
data class StoryPanelUi(
    val scene: String,
    val caption: String,
    val narration: String?,
    val layers: List<StoryLayerUi> = emptyList(),
    val zoom: Motion? = null,
)

/** A whole story: [figure] as written in the pack ("Raden Ajeng Kartini (1879–1904)"), [emblem] the art of their work. */
data class StoryUi(
    val storyId: String,
    val title: String,
    val figure: String,
    val source: String?,
    val emblem: String?,
    val panels: List<StoryPanelUi>,
) {
    /** The person's name without the years ("Raden Ajeng Kartini"). */
    val name: String get() = FigureName.name(figure)

    /** The years in brackets ("1879–1904"), if the pack gives them. */
    val years: String? get() = FigureName.years(figure)

    /** The art shown for the story on «Lihat cerita lagi» and in the gallery: its emblem, else its first scene. */
    val emblemOrScene: String? get() = emblem ?: panels.firstOrNull()?.scene
}

object StoryUiMapper {
    /** [story] for [lang]: captions resolved, the narration clip of that language, layers in drawing order. */
    fun map(
        storyId: String,
        story: Story,
        lang: Lang,
    ): StoryUi =
        StoryUi(
            storyId = storyId,
            title = story.title.resolve(lang),
            figure = story.figure,
            source = story.source.takeIf { it.isNotBlank() },
            emblem = story.emblem?.takeIf { it.isNotBlank() },
            panels =
                story.panels.map { p ->
                    StoryPanelUi(
                        scene = p.scene,
                        caption = p.caption.resolve(lang),
                        narration = p.narrationFor(lang)?.takeIf { it.isNotBlank() },
                        layers =
                            p.layersInDrawOrder.map { l ->
                                StoryLayerUi(art = l.art, x = l.x, y = l.y, w = l.w, flip = l.flip, motion = l.motion)
                            },
                        zoom = p.sceneZoom,
                    )
                },
        )
}

/** Splits a pack's `figure` line into the name and the years in brackets at its end. */
object FigureName {
    fun name(figure: String): String {
        val open = bracket(figure) ?: return figure.trim()
        return figure.substring(0, open).trim().ifEmpty { figure.trim() }
    }

    fun years(figure: String): String? {
        val open = bracket(figure) ?: return null
        return figure.substring(open + 1, figure.trimEnd().length - 1).trim().takeIf { it.isNotEmpty() }
    }

    /** Index of the "(" that opens a bracket closing the line, or null. */
    private fun bracket(figure: String): Int? {
        val t = figure.trimEnd()
        if (!t.endsWith(")")) return null
        return t.lastIndexOf('(').takeIf { it > 0 }
    }
}
