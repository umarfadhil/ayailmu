package id.petalytix.ayailmu.core.billing

import android.app.Activity
import kotlinx.coroutines.flow.Flow

/** Play's answer, reduced to what the app acts on. */
enum class BillingCode {
    OK,
    USER_CANCELED,
    ITEM_ALREADY_OWNED,

    /** Play Store missing, signed out, offline or disconnected: keep the cache, try again later (CR-BIL-3). */
    UNAVAILABLE,
    ERROR,
}

/** A Play purchase without Play types, so the repository is unit-tested with a fake gateway. */
data class PlayPurchase(
    val productIds: List<String>,
    val state: State,
    val token: String,
    val acknowledged: Boolean,
    val originalJson: String,
    val signature: String,
) {
    enum class State { PURCHASED, PENDING, UNSPECIFIED }
}

/** A product as Play sells it to this user: the price is Play's formatted string, never computed here. */
data class StoreProduct(
    val product: Product,
    val formattedPrice: String,
)

/** [value] is null unless [code] is OK. */
data class GatewayResult<T>(
    val code: BillingCode,
    val value: T?,
)

/** Delivered by Play after a purchase flow, and for purchases completed outside the app (pending ones). */
data class PurchaseUpdate(
    val code: BillingCode,
    val purchases: List<PlayPurchase>,
)

/** The only door to Google Play Billing (CR-BIL-*). [PlayBillingGateway] in the app, a fake in tests. */
interface BillingGateway {
    val updates: Flow<PurchaseUpdate>

    suspend fun queryPurchases(): GatewayResult<List<PlayPurchase>>

    suspend fun queryProducts(products: Collection<Product>): GatewayResult<List<StoreProduct>>

    suspend fun acknowledge(token: String): BillingCode

    /** Opens Play's purchase sheet. OK means the sheet opened; the outcome arrives on [updates]. */
    suspend fun launchPurchase(
        activity: Activity,
        product: Product,
    ): BillingCode
}
