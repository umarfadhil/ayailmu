package id.petalytix.ayailmu.core.billing

import android.app.Activity
import id.petalytix.ayailmu.core.model.Subject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.util.Base64

/** Entitlements on a fake Play (CR-BIL-1..4): pending never unlocks, offline keeps the cache, live answers rule. */
@OptIn(ExperimentalCoroutinesApi::class)
class EntitlementRepositoryTest {
    private class FakeGateway : BillingGateway {
        val updatesFlow = MutableSharedFlow<PurchaseUpdate>(extraBufferCapacity = 8)
        override val updates = updatesFlow
        var live: GatewayResult<List<PlayPurchase>> = GatewayResult(BillingCode.OK, emptyList())
        val acknowledged = mutableListOf<String>()
        var launchCode = BillingCode.OK
        var launched = 0

        override suspend fun queryPurchases() = live

        override suspend fun queryProducts(products: Collection<Product>) =
            GatewayResult(BillingCode.OK, products.map { StoreProduct(it, "Rp 59.000") })

        override suspend fun acknowledge(token: String): BillingCode {
            acknowledged += token
            return BillingCode.OK
        }

        override suspend fun launchPurchase(
            activity: Activity,
            product: Product,
        ): BillingCode {
            launched++
            return launchCode
        }
    }

    private fun purchase(
        id: String,
        state: PlayPurchase.State = PlayPurchase.State.PURCHASED,
        acknowledged: Boolean = false,
        json: String = """{"productId":"$id"}""",
        signature: String = "sig",
    ) = PlayPurchase(listOf(id), state, token = "tok-$id", acknowledged = acknowledged, originalJson = json, signature = signature)

    private fun TestScope.repo(
        gateway: FakeGateway,
        cache: EntitlementCache = InMemoryEntitlementCache(),
        verifier: PurchaseVerifier = PurchaseVerifier(""),
    ): EntitlementRepository = EntitlementRepository(gateway, cache, verifier, now = { 1_000L }, scope = backgroundScope)

    @Test
    fun `a purchased pack unlocks and is acknowledged once`() =
        runTest {
            val g = FakeGateway()
            g.live = GatewayResult(BillingCode.OK, listOf(purchase("pack_sains_lifetime")))
            val r = repo(g)
            assertEquals(EntitlementRepository.RefreshResult.CONFIRMED, r.refresh())
            assertTrue(r.entitlements.value.unlocks(Product.PACK_SAINS))
            assertFalse(r.entitlements.value.unlocks(Product.PACK_MATEMATIKA))
            assertEquals(listOf("tok-pack_sains_lifetime"), g.acknowledged)
            assertEquals(1_000L, r.entitlements.value.confirmedAtEpochMs)
        }

    @Test
    fun `all-access unlocks every pack`() =
        runTest {
            val g = FakeGateway()
            g.live = GatewayResult(BillingCode.OK, listOf(purchase("all_access_lifetime", acknowledged = true)))
            val r = repo(g)
            r.refresh()
            Product.entries.forEach { assertTrue(it.name, r.entitlements.value.unlocks(it)) }
            assertTrue(g.acknowledged.isEmpty())
        }

    @Test
    fun `a pending purchase never unlocks`() =
        runTest {
            val g = FakeGateway()
            g.live = GatewayResult(BillingCode.OK, listOf(purchase("pack_bahasa_lifetime", state = PlayPurchase.State.PENDING)))
            val r = repo(g)
            r.refresh()
            assertFalse(r.entitlements.value.unlocks(Product.PACK_BAHASA))
            assertTrue(r.entitlements.value.isPending(Product.PACK_BAHASA))
            assertTrue(g.acknowledged.isEmpty())
        }

    @Test
    fun `offline keeps the cached entitlements`() =
        runTest {
            val g = FakeGateway()
            g.live = GatewayResult(BillingCode.UNAVAILABLE, null)
            val cache = InMemoryEntitlementCache(Entitlements(owned = setOf(Product.PACK_MATEMATIKA), confirmedAtEpochMs = 5L))
            val r = repo(g, cache)
            assertEquals(EntitlementRepository.RefreshResult.UNAVAILABLE, r.refresh())
            assertTrue(r.entitlements.value.unlocks(Product.PACK_MATEMATIKA))
            assertEquals(setOf(Product.PACK_MATEMATIKA), cache.value.owned)
        }

    @Test
    fun `a live answer without the purchase revokes it (refund)`() =
        runTest {
            val g = FakeGateway()
            g.live = GatewayResult(BillingCode.OK, emptyList())
            val cache = InMemoryEntitlementCache(Entitlements(owned = setOf(Product.PACK_MATEMATIKA)))
            val r = repo(g, cache)
            r.refresh()
            assertFalse(r.entitlements.value.unlocks(Product.PACK_MATEMATIKA))
            assertTrue(cache.value.owned.isEmpty())
        }

    @Test
    fun `a forged purchase is ignored when the licence key is set`() =
        runTest {
            val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
            val publicKey = Base64.getEncoder().encodeToString(keys.public.encoded)
            val good = """{"productId":"pack_sains_lifetime","purchaseState":0}"""
            val forged = """{"productId":"pack_matematika_lifetime","purchaseState":0}"""
            val g = FakeGateway()
            g.live =
                GatewayResult(
                    BillingCode.OK,
                    listOf(
                        purchase("pack_sains_lifetime", json = good, signature = sign(keys.private, good)),
                        purchase("pack_matematika_lifetime", json = forged, signature = sign(keys.private, good)),
                    ),
                )
            val r = repo(g, verifier = PurchaseVerifier(publicKey))
            r.refresh()
            assertTrue(r.entitlements.value.unlocks(Product.PACK_SAINS))
            assertFalse(r.entitlements.value.unlocks(Product.PACK_MATEMATIKA))
            assertEquals(listOf("tok-pack_sains_lifetime"), g.acknowledged)
        }

    @Test
    fun `a purchase update unlocks and tells the store`() =
        runTest {
            val g = FakeGateway()
            val r = repo(g)
            val notices = mutableListOf<BillingNotice>()
            backgroundScope.launchCollect(r, notices)
            runCurrent()
            g.updatesFlow.emit(PurchaseUpdate(BillingCode.OK, listOf(purchase("pack_sosial_seni_lifetime"))))
            runCurrent()
            assertTrue(r.entitlements.value.unlocks(Product.PACK_SOSIAL_SENI))
            assertEquals(listOf<BillingNotice>(BillingNotice.Purchased(Product.PACK_SOSIAL_SENI)), notices)
        }

    @Test
    fun `restore says when nothing was found`() =
        runTest {
            val g = FakeGateway()
            val r = repo(g)
            assertEquals(BillingNotice.NothingToRestore, r.restore())
            g.live = GatewayResult(BillingCode.UNAVAILABLE, null)
            assertEquals(BillingNotice.Unavailable, r.restore())
        }

    @Test
    fun `product ids map to subjects and back`() {
        // Every paid module has its own pack; Nilai is free and has none (MODULES_LEVELS_STORIES.md section 1).
        Subject.entries.filter { it != Subject.NILAI }.forEach { assertEquals(it, Product.forSubject(it)?.subject) }
        assertNull(Product.forSubject(Subject.NILAI))
        assertEquals(Product.PACK_SOSIAL_SENI, Product.forSubject(Subject.SOSIAL_SENI))
        assertEquals(Product.PACK_SEJARAH, Product.forSubject(Subject.SEJARAH))
        assertEquals("pack_sejarah_lifetime", Product.PACK_SEJARAH.playId)
        Product.entries.forEach { assertEquals(it, Product.fromPlayId(it.playId)) }
    }

    @Test
    fun `all-access opens the Sejarah pack and the Sejarah pack opens nothing else`() {
        assertTrue(Entitlements(owned = setOf(Product.ALL_ACCESS)).unlocks(Product.PACK_SEJARAH))
        val sejarah = Entitlements(owned = setOf(Product.PACK_SEJARAH))
        assertTrue(sejarah.unlocks(Product.PACK_SEJARAH))
        assertFalse(sejarah.unlocks(Product.PACK_BAHASA))
    }

    @Test
    fun `a Sejarah purchase is cached by its Play id`() {
        val cached = CachedEntitlements.of(Entitlements(owned = setOf(Product.PACK_SEJARAH)))
        assertEquals(listOf("pack_sejarah_lifetime"), cached.owned)
        assertEquals(setOf(Product.PACK_SEJARAH), cached.toEntitlements().owned)
    }

    @Test
    fun `the cache file keeps ids, not enum names`() {
        val e = Entitlements(owned = setOf(Product.ALL_ACCESS), pending = setOf(Product.PACK_SAINS), confirmedAtEpochMs = 7L)
        val cached = CachedEntitlements.of(e)
        assertEquals(listOf("all_access_lifetime"), cached.owned)
        assertEquals(e, cached.toEntitlements())
        assertEquals(Entitlements(), CachedEntitlements(owned = listOf("retired_product")).toEntitlements())
    }

    private fun sign(
        key: PrivateKey,
        data: String,
    ): String =
        Signature.getInstance("SHA1withRSA").run {
            initSign(key)
            update(data.toByteArray(Charsets.UTF_8))
            Base64.getEncoder().encodeToString(sign())
        }

    private fun CoroutineScope.launchCollect(
        r: EntitlementRepository,
        into: MutableList<BillingNotice>,
    ) = launch(Dispatchers.Unconfined) { r.notices.collect { into += it } }
}
