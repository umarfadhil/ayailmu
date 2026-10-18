package id.petalytix.ayailmu.feature.session.story

import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.ItemType

/**
 * Where the learner is in a story: the panel on screen ([index]) and the furthest panel reached ([furthest]).
 * Panels never move on by themselves (no timers, CR-A11Y-4): only a tap on the picture, «Lanjut» or «Kembali»
 * changes [index]. [finished] = the last panel was reached (or the story was skipped): from then on the session's
 * «Lanjut» answers the story item as "seen". Immutable; the session keeps it in its AnswerDraft, the dialog and
 * the gallery in a remembered state.
 */
data class StoryTimeline(
    val panels: Int,
    val index: Int = 0,
    val furthest: Int = 0,
    val skipped: Boolean = false,
) {
    val isFirst: Boolean get() = index <= 0

    /** On the last panel (a story without panels is always at its end, so it can never block a session). */
    val isLast: Boolean get() = index >= panels - 1

    val finished: Boolean get() = skipped || panels <= 0 || furthest >= panels - 1

    /** The next panel; on the last one nothing changes. */
    fun next(): StoryTimeline =
        if (isLast) {
            this
        } else {
            val i = index + 1
            copy(index = i, furthest = maxOf(furthest, i))
        }

    /** The previous panel; on the first one nothing changes. */
    fun back(): StoryTimeline = if (isFirst) this else copy(index = index - 1)

    /** «Lewati cerita»: counts as seen without stepping through. */
    fun skip(): StoryTimeline = copy(skipped = true)

    /** True once panel [i] has been on screen. */
    fun seen(i: Int): Boolean = i in 0..furthest && i < panels

    companion object {
        fun start(panels: Int): StoryTimeline = StoryTimeline(panels = panels.coerceAtLeast(0))

        /** A page-turn sound goes with every change of panel (Sfx.PAGE), never with the first one. */
        fun turnsPage(
            from: StoryTimeline,
            to: StoryTimeline,
        ): Boolean = from.index != to.index

        /**
         * «Lewati cerita» is offered to adults and to anyone who has seen this story before. A child meeting a story
         * for the first time taps through it (one tap per panel, nothing timed), because its questions follow.
         */
        fun offersSkip(
            adult: Boolean,
            seenBefore: Boolean,
        ): Boolean = adult || seenBefore
    }
}

/** What the voice does when a panel appears. */
sealed interface NarrationCue {
    data class Play(
        val clip: String,
    ) : NarrationCue

    /** No clip for this panel (or not on the phone): silence, so the previous panel's narration never runs on. */
    data object Stop : NarrationCue
}

object StoryNarration {
    /** The panel's clip for the instruction language plays when it is bundled; otherwise the caption carries the panel. */
    fun cue(
        clip: String?,
        has: (String) -> Boolean,
    ): NarrationCue = if (clip != null && has(clip)) NarrationCue.Play(clip) else NarrationCue.Stop

    /** The clip the small speaker replays, or null to hide the speaker. */
    fun replay(
        clip: String?,
        has: (String) -> Boolean,
    ): String? = clip?.takeIf { has(it) }
}

/** "Seen" is recorded the usual way: the story item has an answer event (outcome not_assessed, like info cards). */
object StorySeen {
    /** Story ids whose `story` item in [items] has at least one answer event in [history]. */
    fun storyIds(
        items: List<Item>,
        history: List<AnswerEvent>,
    ): Set<String> {
        val answered = history.mapTo(HashSet()) { it.itemId }
        return items.filter { it.type == ItemType.STORY && it.itemId in answered }.mapNotNullTo(LinkedHashSet()) { it.storyId }
    }

    /** True when [itemId] was answered before (the session offers «Lewati cerita» on a story met again). */
    fun before(
        itemId: String,
        history: List<AnswerEvent>,
    ): Boolean = history.any { it.itemId == itemId }
}
