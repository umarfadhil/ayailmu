package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.ReviewStatus

/**
 * What a build may show (CR-ENG-2): `demo` shows everything behind a draft banner; `prod` shows only
 * approved, non-synthetic content. Gating is read-only — it never changes `review_status`.
 */
data class GatedContent(
    val contentVersion: String,
    val track: String,
    /** True when anything shown is not approved (developer demo). */
    val unreviewed: Boolean,
    /** True when nothing can be shown. */
    val empty: Boolean,
    val prompts: Map<String, LocalizedText>,
    val feedback: Map<String, LocalizedText>,
    val screens: List<LessonScreen>,
    val readings: Map<String, Reading>,
    val items: List<Item>,
) {
    private val byId: Map<String, Item> = items.associateBy { it.itemId }

    fun item(id: String): Item = byId[id] ?: throw IllegalArgumentException("Item $id is not available in this content")

    fun itemOrNull(id: String): Item? = byId[id]
}

object Gating {
    fun isShowable(
        status: ReviewStatus,
        synthetic: Boolean,
        developerDemo: Boolean,
    ): Boolean = developerDemo || (!synthetic && status == ReviewStatus.APPROVED)

    fun gate(
        pack: ContentPack,
        developerDemo: Boolean,
    ): GatedContent {
        val items = pack.items.filter { isShowable(it.reviewStatus, pack.synthetic, developerDemo) }
        val screens = pack.screens.filter { isShowable(it.reviewStatus, pack.synthetic, developerDemo) }
        val readings = pack.readings.filterValues { isShowable(it.reviewStatus, pack.synthetic, developerDemo) }
        val unreviewed =
            pack.synthetic ||
                items.any { it.reviewStatus != ReviewStatus.APPROVED } ||
                screens.any { it.reviewStatus != ReviewStatus.APPROVED }
        return GatedContent(
            contentVersion = pack.meta.contentVersion,
            track = pack.meta.track,
            unreviewed = unreviewed,
            empty = items.isEmpty(),
            prompts = pack.prompts,
            feedback = pack.feedback,
            screens = screens,
            readings = readings,
            items = items,
        )
    }
}
