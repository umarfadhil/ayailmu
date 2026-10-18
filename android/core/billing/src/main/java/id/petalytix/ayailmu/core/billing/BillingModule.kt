package id.petalytix.ayailmu.core.billing

import android.content.Context
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

/** Build-time billing settings, provided by :app from BuildConfig (the key is never committed, CR-BIL-4). */
data class BillingConfig(
    val playLicenseKey: String,
)

@Module
@InstallIn(SingletonComponent::class)
object BillingModule {
    @Provides
    @Singleton
    fun provideGateway(
        @ApplicationContext context: Context,
    ): BillingGateway = PlayBillingGateway(context)

    @Provides
    @Singleton
    fun provideEntitlementCache(
        @ApplicationContext context: Context,
    ): EntitlementCache =
        DataStoreEntitlementCache(
            DataStoreFactory.create(
                serializer = CachedEntitlementsSerializer,
                // An unreadable cache means "nothing cached": the next live query restores the truth.
                corruptionHandler = ReplaceFileCorruptionHandler { CachedEntitlements() },
                produceFile = { context.dataStoreFile("entitlements.json") },
            ),
        )

    @Provides
    @Singleton
    fun provideEntitlementRepository(
        gateway: BillingGateway,
        cache: EntitlementCache,
        config: BillingConfig,
    ): EntitlementRepository =
        EntitlementRepository(
            gateway = gateway,
            cache = cache,
            verifier = PurchaseVerifier(config.playLicenseKey),
            now = System::currentTimeMillis,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        )
}
