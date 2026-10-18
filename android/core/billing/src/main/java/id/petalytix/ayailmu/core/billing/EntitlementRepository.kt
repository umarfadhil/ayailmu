package id.petalytix.ayailmu.core.billing

import android.app.Activity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One-off messages for the store screen. Calm wording lives in the app's strings. */
sealed interface BillingNotice {
    data class Purchased(
        val product: Product,
    ) : BillingNotice

    data class Pending(
        val product: Product,
    ) : BillingNotice

    data object Cancelled : BillingNotice

    data object AlreadyOwned : BillingNotice

    data object Unavailable : BillingNotice

    data object Failed : BillingNotice

    data object Restored : BillingNotice

    data object NothingToRestore : BillingNotice
}

/**
 * The single source of what this phone has paid for (CR-BIL-2..4).
 *
 * - Start: the cached entitlements are published at once, so paid units open offline (CR-BIL-3).
 * - [refresh] (app start, every resume, the store, "Restore purchases"): asks Play for the live purchases.
 *   Only a successful live answer can remove an entitlement; offline or Play errors keep the cache.
 * - PURCHASED + valid signature unlocks and is acknowledged at once (Play refunds unacknowledged purchases
 *   after three days); a failed acknowledgement is retried on the next refresh. PENDING never unlocks.
 */
class EntitlementRepository(
    private val gateway: BillingGateway,
    private val cache: EntitlementCache,
    private val verifier: PurchaseVerifier,
    private val now: () -> Long,
    scope: CoroutineScope,
) {
    private val state = MutableStateFlow(Entitlements())
    val entitlements: StateFlow<Entitlements> = state.asStateFlow()

    private val noticeFlow = MutableSharedFlow<BillingNotice>(extraBufferCapacity = 16)
    val notices: Flow<BillingNotice> = noticeFlow.asSharedFlow()

    private val loaded = CompletableDeferred<Unit>()
    private val lock = Mutex()

    init {
        scope.launch {
            state.value =
                try {
                    cache.read()
                } catch (e: Exception) {
                    Entitlements()
                }
            loaded.complete(Unit)
            gateway.updates.collect { onUpdate(it) }
        }
    }

    enum class RefreshResult { CONFIRMED, UNAVAILABLE }

    /**
     * Suspends until the cached entitlements are published. Readers that decide access (sessions, progress,
     * Home) wait for this, so a paying learner never sees a free-only session right after a cold start.
     */
    suspend fun awaitLoaded() = loaded.await()

    suspend fun refresh(): RefreshResult {
        loaded.await()
        val live = gateway.queryPurchases()
        val purchases = live.value
        if (live.code != BillingCode.OK || purchases == null) return RefreshResult.UNAVAILABLE
        lock.withLock { apply(purchases, replace = true) }
        return RefreshResult.CONFIRMED
    }

    /** "Pulihkan pembelian": the same live query, with a message either way. */
    suspend fun restore(): BillingNotice {
        val notice =
            when (refresh()) {
                RefreshResult.UNAVAILABLE -> BillingNotice.Unavailable
                RefreshResult.CONFIRMED ->
                    if (state.value.owned.isEmpty() && state.value.pending.isEmpty()) BillingNotice.NothingToRestore else BillingNotice.Restored
            }
        noticeFlow.tryEmit(notice)
        return notice
    }

    suspend fun products(): GatewayResult<List<StoreProduct>> = gateway.queryProducts(Product.entries)

    suspend fun buy(
        activity: Activity,
        product: Product,
    ): BillingCode {
        loaded.await()
        if (state.value.unlocks(product)) {
            noticeFlow.tryEmit(BillingNotice.AlreadyOwned)
            return BillingCode.ITEM_ALREADY_OWNED
        }
        val code = gateway.launchPurchase(activity, product)
        when (code) {
            BillingCode.OK -> Unit // the result arrives on gateway.updates
            BillingCode.USER_CANCELED -> noticeFlow.tryEmit(BillingNotice.Cancelled)
            BillingCode.ITEM_ALREADY_OWNED -> {
                noticeFlow.tryEmit(BillingNotice.AlreadyOwned)
                refresh()
            }
            BillingCode.UNAVAILABLE -> noticeFlow.tryEmit(BillingNotice.Unavailable)
            BillingCode.ERROR -> noticeFlow.tryEmit(BillingNotice.Failed)
        }
        return code
    }

    internal suspend fun onUpdate(update: PurchaseUpdate) {
        loaded.await()
        when (update.code) {
            BillingCode.OK -> {
                val before = state.value
                val after = lock.withLock { apply(update.purchases, replace = false) }
                update.purchases.forEach { p ->
                    p.productIds.mapNotNull { Product.fromPlayId(it) }.forEach { product ->
                        when {
                            product in after.owned && product !in before.owned -> noticeFlow.tryEmit(BillingNotice.Purchased(product))
                            product in after.pending && product !in before.pending -> noticeFlow.tryEmit(BillingNotice.Pending(product))
                            p.state == PlayPurchase.State.PURCHASED && product !in after.owned -> noticeFlow.tryEmit(BillingNotice.Failed)
                        }
                    }
                }
            }
            BillingCode.USER_CANCELED -> noticeFlow.tryEmit(BillingNotice.Cancelled)
            BillingCode.ITEM_ALREADY_OWNED -> {
                noticeFlow.tryEmit(BillingNotice.AlreadyOwned)
                refresh()
            }
            BillingCode.UNAVAILABLE -> noticeFlow.tryEmit(BillingNotice.Unavailable)
            BillingCode.ERROR -> noticeFlow.tryEmit(BillingNotice.Failed)
        }
    }

    /**
     * [replace] = a complete live list (refresh): it becomes the truth. Otherwise (a purchase update, which
     * lists only the purchases it is about) it is merged into what is already known.
     */
    private suspend fun apply(
        purchases: List<PlayPurchase>,
        replace: Boolean,
    ): Entitlements {
        val owned = mutableSetOf<Product>()
        val pending = mutableSetOf<Product>()
        for (p in purchases) {
            val products = p.productIds.mapNotNull { Product.fromPlayId(it) }
            when (p.state) {
                PlayPurchase.State.PURCHASED ->
                    if (verifier.verify(p.originalJson, p.signature)) {
                        owned += products
                        if (!p.acknowledged) gateway.acknowledge(p.token)
                    }
                PlayPurchase.State.PENDING -> pending += products
                PlayPurchase.State.UNSPECIFIED -> Unit
            }
        }
        val current = state.value
        val next =
            if (replace) {
                Entitlements(owned = owned, pending = pending - owned, confirmedAtEpochMs = now())
            } else {
                val allOwned = current.owned + owned
                Entitlements(owned = allOwned, pending = (current.pending + pending) - allOwned, confirmedAtEpochMs = current.confirmedAtEpochMs)
            }
        state.value = next
        try {
            cache.write(next)
        } catch (e: Exception) {
            // The in-memory state is still right; the cache catches up on the next refresh.
        }
        return next
    }
}
