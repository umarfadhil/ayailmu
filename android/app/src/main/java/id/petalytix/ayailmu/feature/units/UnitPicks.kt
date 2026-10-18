package id.petalytix.ayailmu.feature.units

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.content.UnitInfo
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.StepMapper
import kotlin.random.Random

/** One unit on the Units screen. [title] is null for packs without a unit list (shown as "Unit A"). */
data class UnitRow(
    val unit: String,
    val title: String?,
    val sticker: String?,
    /** Not open for this learner yet (free tier, MONETIZATION_SCHEME): visible, previewable, never hidden. */
    val locked: Boolean,
    /** Practice questions answered at least once, of all practice questions in the unit. */
    val answered: Int,
    val total: Int,
    val challengeDone: Boolean,
    /** At least one question the challenge can ask (seen, quick to answer); false only for unusual units. */
    val challengeable: Boolean = true,
) {
    val practiceDone: Boolean get() = total > 0 && answered >= total

    /** The unit challenge opens once every practice question was answered (any result). */
    val challengeReady: Boolean get() = !locked && practiceDone && !challengeDone && challengeable
}

/**
 * Pure rules for the Units screen, the locked-unit preview and the unit challenge (P5 free tier, P6). Practice
 * only: neither the preview nor the challenge writes answer events, so neither can become evidence (CR-ENG-9).
 */
object UnitPicks {
    const val CHALLENGE_SIZE = 5

    /**
     * Renderers that make a fair one-question preview (no typing, no reading needed). Info cards and stories are
     * never picked: they are seen, not answered (stories, follow-up 12, are RenderKind.STORY).
     */
    private val PREVIEW_KINDS =
        setOf(
            RenderKind.CHOICE, RenderKind.NUMBER, RenderKind.HOTSPOT, RenderKind.SLIDER, RenderKind.SEQUENCE,
            RenderKind.PAIRS, RenderKind.BUCKETS, RenderKind.MEMORY,
        )

    /** Quick, single-answer kinds for the challenge (never an info card or a story). */
    private val CHALLENGE_KINDS = setOf(RenderKind.CHOICE, RenderKind.NUMBER, RenderKind.HOTSPOT, RenderKind.SLIDER)

    private fun fits(
        item: Item,
        audience: Audience,
    ) = item.audience == null || item.audience == audience

    fun practice(
        content: GatedContent,
        unit: String,
        audience: Audience,
    ): List<Item> = content.items.filter { it.unit == unit && it.pool == Pool.PRACT && it.type.isV1 && fits(it, audience) }

    /** Units in pack order; packs without a unit list (the Arabic DEMO pack) list the units their questions use. */
    fun rows(
        units: List<UnitInfo>,
        content: GatedContent,
        history: List<AnswerEvent>,
        audience: Audience,
        lang: Lang,
        allows: (String) -> Boolean,
        completed: Set<String>,
    ): List<UnitRow> {
        val answered = history.map { it.itemId }.toSet()
        val listed =
            units.ifEmpty {
                content.items.filter { it.pool == Pool.PRACT && fits(it, audience) }.map { it.unit }.distinct().map { UnitInfo(it, EMPTY_TITLE) }
            }
        return listed.mapNotNull { u ->
            val practice = practice(content, u.unit, audience)
            if (practice.isEmpty()) return@mapNotNull null
            UnitRow(
                unit = u.unit,
                title = u.title.resolve(lang).takeIf { it.isNotBlank() },
                sticker = u.sticker,
                locked = !allows(u.unit),
                answered = practice.count { it.itemId in answered },
                total = practice.size,
                challengeDone = u.unit in completed,
                challengeable = challengePool(content, u.unit, audience, answered).isNotEmpty(),
            )
        }
    }

    /**
     * The first practice question of the unit that previews well (stable, so the preview never changes). A question
     * that needs its story (`story_id`) comes last: the preview has no story to show before it.
     */
    fun previewItem(
        content: GatedContent,
        unit: String,
        audience: Audience,
    ): Item? =
        practice(content, unit, audience)
            .filter { it.readingId == null && StepMapper.kindOf(it) in PREVIEW_KINDS }
            .minWithOrNull(compareBy<Item>({ it.storyId != null }, { it.order ?: Int.MAX_VALUE }, { it.itemId }))

    /** Up to [CHALLENGE_SIZE] questions of the unit the learner has already met, in a fresh order each time. */
    fun challengeItems(
        content: GatedContent,
        unit: String,
        audience: Audience,
        history: List<AnswerEvent>,
        random: Random,
    ): List<Item> = challengePool(content, unit, audience, history.map { it.itemId }.toSet()).shuffled(random).take(CHALLENGE_SIZE)

    private fun challengePool(
        content: GatedContent,
        unit: String,
        audience: Audience,
        seen: Set<String>,
    ): List<Item> =
        content.items.filter {
            it.unit == unit &&
                (it.pool == Pool.PRACT || it.pool == Pool.REMED) &&
                fits(it, audience) &&
                it.itemId in seen &&
                it.readingId == null &&
                StepMapper.kindOf(it) in CHALLENGE_KINDS
        }

    private val EMPTY_TITLE = id.petalytix.ayailmu.core.model.LocalizedText("", "")
}
