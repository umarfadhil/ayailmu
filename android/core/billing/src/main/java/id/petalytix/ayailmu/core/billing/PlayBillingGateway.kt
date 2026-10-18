package id.petalytix.ayailmu.core.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * Google Play Billing Library 8 (CR-BIL-1: 8.x is required for app updates after 31 Aug 2026). One client for
 * the app's lifetime, reconnected by the library itself (enableAutoServiceReconnection). Pending purchases are
 * enabled for one-time products so learners can pay at a minimarket or by bank transfer.
 *
 * IN SOURCE (not compiled): the Billing 8 calls follow developer.android.com/google/play/billing/integrate
 * as read on 2026-10-17; the Windows Gradle run is the first compile.
 */
class PlayBillingGateway(
    context: Context,
) : BillingGateway {
    private val updatesFlow = MutableSharedFlow<PurchaseUpdate>(extraBufferCapacity = 16)
    override val updates: Flow<PurchaseUpdate> = updatesFlow.asSharedFlow()

    private val listener =
        PurchasesUpdatedListener { result, purchases ->
            updatesFlow.tryEmit(PurchaseUpdate(code(result), purchases.orEmpty().map { toPlay(it) }))
        }

    private val client: BillingClient =
        BillingClient
            .newBuilder(context.applicationContext)
            .setListener(listener)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build()

    private val connectLock = Mutex()

    /** ProductDetails from the last successful query; the purchase flow needs them. */
    private val details = ConcurrentHashMap<Product, ProductDetails>()

    private suspend fun connected(): Boolean =
        connectLock.withLock {
            if (client.isReady) return@withLock true
            withTimeoutOrNull(CONNECT_TIMEOUT_MS) {
                suspendCancellableCoroutine { cont ->
                    client.startConnection(
                        object : BillingClientStateListener {
                            override fun onBillingSetupFinished(result: BillingResult) {
                                if (cont.isActive) cont.resume(result.responseCode == BillingResponseCode.OK)
                            }

                            override fun onBillingServiceDisconnected() {
                                if (cont.isActive) cont.resume(false)
                            }
                        },
                    )
                }
            } ?: false
        }

    override suspend fun queryPurchases(): GatewayResult<List<PlayPurchase>> {
        if (!connected()) return GatewayResult(BillingCode.UNAVAILABLE, null)
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        return suspendCancellableCoroutine { cont ->
            client.queryPurchasesAsync(params) { result, purchases ->
                val code = code(result)
                if (cont.isActive) cont.resume(GatewayResult(code, if (code == BillingCode.OK) purchases.map { toPlay(it) } else null))
            }
        }
    }

    override suspend fun queryProducts(products: Collection<Product>): GatewayResult<List<StoreProduct>> {
        if (!connected()) return GatewayResult(BillingCode.UNAVAILABLE, null)
        val params =
            QueryProductDetailsParams
                .newBuilder()
                .setProductList(
                    products.map {
                        QueryProductDetailsParams.Product
                            .newBuilder()
                            .setProductId(it.playId)
                            .setProductType(BillingClient.ProductType.INAPP)
                            .build()
                    },
                ).build()
        return suspendCancellableCoroutine { cont ->
            client.queryProductDetailsAsync(params) { result, queryResult ->
                val code = code(result)
                val list =
                    if (code == BillingCode.OK) {
                        queryResult.productDetailsList.mapNotNull { pd ->
                            val product = Product.fromPlayId(pd.productId) ?: return@mapNotNull null
                            val price = priceOf(pd) ?: return@mapNotNull null
                            details[product] = pd
                            StoreProduct(product, price)
                        }
                    } else {
                        null
                    }
                if (cont.isActive) cont.resume(GatewayResult(code, list))
            }
        }
    }

    override suspend fun acknowledge(token: String): BillingCode {
        if (!connected()) return BillingCode.UNAVAILABLE
        val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()
        return suspendCancellableCoroutine { cont ->
            client.acknowledgePurchase(params) { result -> if (cont.isActive) cont.resume(code(result)) }
        }
    }

    override suspend fun launchPurchase(
        activity: Activity,
        product: Product,
    ): BillingCode {
        if (!connected()) return BillingCode.UNAVAILABLE
        val pd = details[product] ?: queryProducts(listOf(product)).let { details[product] } ?: return BillingCode.ERROR
        val offer = pd.oneTimePurchaseOfferDetailsList?.firstOrNull()
        val productParams =
            BillingFlowParams.ProductDetailsParams
                .newBuilder()
                .setProductDetails(pd)
                .apply { offer?.offerToken?.let { setOfferToken(it) } }
                .build()
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(productParams)).build()
        // launchBillingFlow must run on the main thread.
        return withContext(Dispatchers.Main) { code(client.launchBillingFlow(activity, params)) }
    }

    private fun priceOf(pd: ProductDetails): String? =
        pd.oneTimePurchaseOfferDetailsList?.firstOrNull()?.formattedPrice
            ?: pd.oneTimePurchaseOfferDetails?.formattedPrice

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000L

        fun code(result: BillingResult): BillingCode =
            when (result.responseCode) {
                BillingResponseCode.OK -> BillingCode.OK
                BillingResponseCode.USER_CANCELED -> BillingCode.USER_CANCELED
                BillingResponseCode.ITEM_ALREADY_OWNED -> BillingCode.ITEM_ALREADY_OWNED
                BillingResponseCode.SERVICE_UNAVAILABLE,
                BillingResponseCode.BILLING_UNAVAILABLE,
                BillingResponseCode.SERVICE_DISCONNECTED,
                BillingResponseCode.NETWORK_ERROR,
                -> BillingCode.UNAVAILABLE
                else -> BillingCode.ERROR
            }

        fun toPlay(p: Purchase): PlayPurchase =
            PlayPurchase(
                productIds = p.products,
                state =
                    when (p.purchaseState) {
                        Purchase.PurchaseState.PURCHASED -> PlayPurchase.State.PURCHASED
                        Purchase.PurchaseState.PENDING -> PlayPurchase.State.PENDING
                        else -> PlayPurchase.State.UNSPECIFIED
                    },
                token = p.purchaseToken,
                acknowledged = p.isAcknowledged,
                originalJson = p.originalJson,
                signature = p.signature,
            )
    }
}
