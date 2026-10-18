package id.petalytix.ayailmu.feature.store

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.billing.BillingCode
import id.petalytix.ayailmu.core.billing.BillingNotice
import id.petalytix.ayailmu.core.billing.EntitlementRepository
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.random.Random

/** One product on the store page. [price] is Play's formatted price, null until Play answers (CR-BIL-6). */
data class StoreItem(
    val product: Product,
    val price: String?,
    val owned: Boolean,
    val pending: Boolean,
)

data class StoreData(
    val items: List<StoreItem>,
    /** False while Play has not answered, or cannot (offline, no Play Store, the demo build's app id). */
    val pricesAvailable: Boolean,
    /** A child profile is active: the adult gate comes first (CR-BIL-5). */
    val childProfile: Boolean,
    val demo: Boolean,
    val unlockAll: Boolean,
)

interface StoreDataSource {
    fun observe(): Flow<StoreData>

    val notices: Flow<BillingNotice>

    /** Live purchases and prices from Play. */
    suspend fun refresh()

    suspend fun buy(
        activity: Activity,
        product: Product,
    )

    suspend fun restore()
}

class DefaultStoreDataSource
    @Inject
    constructor(
        private val repo: EntitlementRepository,
        private val access: AccessSource,
        private val profiles: ProfileRepository,
        private val build: AppBuildInfo,
    ) : StoreDataSource {
        private val prices = MutableStateFlow<Map<Product, String>?>(null)

        override fun observe(): Flow<StoreData> =
            combine(access.observe(), prices, profiles.observeActive()) { ctx, p, profile ->
                StoreData(
                    items = ORDER.map { StoreItem(it, p?.get(it), ctx.entitlements.unlocks(it), ctx.entitlements.isPending(it)) },
                    pricesAvailable = p != null,
                    childProfile = profile?.kind == ProfileKind.ANAK,
                    demo = build.developerDemo,
                    unlockAll = ctx.unlockAll,
                )
            }

        override val notices: Flow<BillingNotice> = repo.notices

        override suspend fun refresh() {
            repo.refresh()
            val result = repo.products()
            val list = result.value
            if (result.code == BillingCode.OK && list != null && list.isNotEmpty()) prices.value = list.associate { it.product to it.formattedPrice }
        }

        override suspend fun buy(
            activity: Activity,
            product: Product,
        ) {
            repo.buy(activity, product)
        }

        override suspend fun restore() {
            repo.restore()
        }

        companion object {
            /**
             * All-access first: it is the one most families want. Nilai has no product and never appears here (it is
             * free, shown «Gratis» on its module card).
             */
            val ORDER =
                listOf(
                    Product.ALL_ACCESS,
                    Product.PACK_BAHASA,
                    Product.PACK_MATEMATIKA,
                    Product.PACK_SAINS,
                    Product.PACK_SOSIAL_SENI,
                    Product.PACK_SEJARAH,
                )
        }
    }

/**
 * Hold-to-confirm plus a times-table question (CR-BIL-5): easy for a parent, a real pause for a young child.
 * Not a security boundary: Play's own purchase authentication still applies.
 */
data class AdultGate(
    val a: Int,
    val b: Int,
    val answer: String = "",
) {
    val solved: Boolean get() = answer.trim().toIntOrNull() == a * b

    companion object {
        fun next(random: Random = Random.Default): AdultGate = AdultGate(a = random.nextInt(6, 10), b = random.nextInt(3, 10))
    }
}

data class StoreUiState(
    val data: StoreData? = null,
    /** Non-null while the adult gate stands between a child profile and the buy buttons. */
    val gate: AdultGate? = null,
    val gatePassed: Boolean = false,
    val busy: Boolean = false,
    val notice: BillingNotice? = null,
    val failed: Boolean = false,
)

sealed interface StoreEvent {
    data class GateAnswer(
        val text: String,
    ) : StoreEvent

    data object GateConfirmed : StoreEvent

    data object Restore : StoreEvent

    data object NoticeShown : StoreEvent
}

@HiltViewModel
class StoreViewModel
    @Inject
    constructor(
        private val data: StoreDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow(StoreUiState())
        val state: StateFlow<StoreUiState> = _state.asStateFlow()

        init {
            viewModelScope.launch {
                data
                    .observe()
                    .catch { _state.update { it.copy(failed = true) } }
                    .collect { d ->
                        _state.update { s ->
                            val gate = if (d.childProfile && !s.gatePassed) s.gate ?: AdultGate.next() else null
                            s.copy(data = d, gate = gate)
                        }
                    }
            }
            viewModelScope.launch { data.notices.collect { n -> _state.update { it.copy(notice = n) } } }
            viewModelScope.launch { runCatching { data.refresh() } }
        }

        fun onEvent(event: StoreEvent) {
            when (event) {
                is StoreEvent.GateAnswer -> _state.update { s -> s.copy(gate = s.gate?.copy(answer = event.text.filter { it.isDigit() }.take(3))) }
                StoreEvent.GateConfirmed ->
                    _state.update { s -> if (s.gate?.solved == true) s.copy(gate = null, gatePassed = true) else s }
                StoreEvent.Restore -> launchAction { data.restore() }
                StoreEvent.NoticeShown -> _state.update { it.copy(notice = null) }
            }
        }

        /** Needs the visible activity: Play draws its purchase sheet over it. */
        fun buy(
            activity: Activity,
            product: Product,
        ) {
            val s = _state.value
            if (s.gate != null) return
            launchAction { data.buy(activity, product) }
        }

        private fun launchAction(block: suspend () -> Unit) {
            if (_state.value.busy) return
            _state.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    block()
                } catch (e: Exception) {
                    _state.update { it.copy(notice = BillingNotice.Failed) }
                } finally {
                    _state.update { it.copy(busy = false) }
                }
            }
        }
    }
