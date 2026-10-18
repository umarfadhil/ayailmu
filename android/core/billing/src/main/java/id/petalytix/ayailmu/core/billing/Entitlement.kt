package id.petalytix.ayailmu.core.billing

import id.petalytix.ayailmu.core.model.Subject

/**
 * Product ids as listed in ai-memory/MONETIZATION_SCHEME.md (DECIDED 2026-10-17: one-time, INAPP, no upgrade
 * product). Ids never change once live. [subject] is the pack meta `subject` a product unlocks; all-access has none
 * and unlocks every pack, Sejarah included. Prices are never written here: the store shows Play's formatted price
 * only (CR-BIL-6). Follow-up 12 (MODULES_LEVELS_STORIES.md section 1): Sejarah is a paid pack like the other subjects;
 * Nilai has no product at all ([forSubject] is null), so every Nilai unit is free.
 */
enum class Product(
    val playId: String,
    val subject: Subject?,
) {
    PACK_BAHASA("pack_bahasa_lifetime", Subject.BAHASA),
    PACK_MATEMATIKA("pack_matematika_lifetime", Subject.MATEMATIKA),
    PACK_SAINS("pack_sains_lifetime", Subject.SAINS),
    PACK_SOSIAL_SENI("pack_sosial_seni_lifetime", Subject.SOSIAL_SENI),
    PACK_SEJARAH("pack_sejarah_lifetime", Subject.SEJARAH),
    ALL_ACCESS("all_access_lifetime", null),
    ;

    companion object {
        /** The pack that opens [subject]; null for a free module (Nilai), whose units are all open. */
        fun forSubject(subject: Subject): Product? = entries.firstOrNull { it.subject == subject }

        fun fromPlayId(id: String): Product? = entries.firstOrNull { it.playId == id }
    }
}

/**
 * What the learner owns, as last confirmed by Play (CR-BIL-2) or restored from the offline cache (CR-BIL-3).
 * [pending] purchases (paid later, e.g. at a minimarket) are shown as "waiting for payment" and unlock nothing
 * until Play reports them purchased (CR-BIL-1).
 */
data class Entitlements(
    val owned: Set<Product> = emptySet(),
    val pending: Set<Product> = emptySet(),
    val confirmedAtEpochMs: Long? = null,
) {
    fun unlocks(product: Product): Boolean = product in owned || Product.ALL_ACCESS in owned

    fun isPending(product: Product): Boolean = product in pending && !unlocks(product)
}
