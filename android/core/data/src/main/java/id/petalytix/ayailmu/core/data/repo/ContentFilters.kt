package id.petalytix.ayailmu.core.data.repo

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.model.ItemType

/**
 * The missing-clip rule (INTERACTIONS_AUDIO.md §3.1), applied once when a track is loaded so every session, daily
 * puzzle, unit preview, challenge and speed round sees the same items:
 *
 * - an `audio_match` item is left out until its `audio` clip is bundled;
 * - a `trace` item is left out until its `trace` key is in the stroke index.
 *
 * Nothing else is filtered: a speaker on an option (or an item-level clip on any other type) simply hides itself
 * in the renderer when the clip is missing, and the question stays.
 */
object ContentFilters {
    fun playableMedia(
        content: GatedContent,
        hasClip: (String) -> Boolean,
        hasStroke: (String) -> Boolean,
    ): GatedContent {
        val items = content.items.filter { mediaAvailable(it, hasClip, hasStroke) }
        return if (items.size == content.items.size) content else content.copy(items = items, empty = items.isEmpty())
    }

    fun mediaAvailable(
        item: Item,
        hasClip: (String) -> Boolean,
        hasStroke: (String) -> Boolean,
    ): Boolean =
        when (item.type) {
            ItemType.AUDIO_MATCH -> item.audio?.let(hasClip) == true
            ItemType.TRACE -> item.trace?.let(hasStroke) == true
            else -> true
        }
}
