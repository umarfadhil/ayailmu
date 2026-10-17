package id.petalytix.ayailmu.core.billing

/**
 * Product ids as listed in ai-memory/MONETIZATION_SCHEME.md. Ids never change once live (one-time, INAPP).
 * The BillingClient wrapper, entitlement repository and adult gate arrive in P5 (CR-BIL-1..6).
 */
enum class Product(val playId: String) {
    PACK_BAHASA("pack_bahasa_lifetime"),
    PACK_MATEMATIKA("pack_matematika_lifetime"),
    PACK_SAINS("pack_sains_lifetime"),
    PACK_SOSIAL_SENI("pack_sosial_seni_lifetime"),
    ALL_ACCESS("all_access_lifetime"),
}

/** What the learner owns, as last confirmed by Play (CR-BIL-2) or restored from the offline cache (CR-BIL-3). */
data class Entitlements(
    val owned: Set<Product> = emptySet(),
    val confirmedAtEpochMs: Long? = null,
) {
    fun unlocks(product: Product): Boolean = product in owned || Product.ALL_ACCESS in owned
}
