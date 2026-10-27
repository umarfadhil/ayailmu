package id.petalytix.ayailmu.feature.account

import android.content.Context
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.core.data.repo.ProfileVisibility
import id.petalytix.ayailmu.feature.settings.NormalLocalCleaner
import id.petalytix.ayailmu.core.sync.Backend
import id.petalytix.ayailmu.core.sync.HttpBackend
import java.io.IOException
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
internal object NormalAccountModule {
    @Provides @Singleton internal fun config(): NormalAccountConfig = NormalAccountConfig.forValues(
        BuildConfig.NORMAL_AUTH_APPROVED, BuildConfig.NORMAL_AUTH_PUBLIC_ORIGIN,
        BuildConfig.NORMAL_SYNC_POLICY_VERSION, BuildConfig.NORMAL_OWNER_DECLARATION_VERSION,
        BuildConfig.NORMAL_REGISTRY_SOURCE_COMMIT, BuildConfig.NORMAL_AUTH_REQUIRED_ORIGIN,
    ).copy(ownerSignInOnly = BuildConfig.NORMAL_OWNER_SIGN_IN_ONLY)
    @Provides @Singleton internal fun backend(config: NormalAccountConfig): Backend =
        if (config.enabled) HttpBackend(config.apiOrigin, synthetic = false, config.syncPolicyVersion, config.ownerDeclarationVersion)
        else DisabledNormalBackend
    @Provides @Singleton internal fun visibility(impl: NormalProfileVisibility): ProfileVisibility = impl
    @Provides @Singleton internal fun vault(@ApplicationContext context: Context, config: NormalAccountConfig): NormalAuthVault = KeystoreNormalAuthVault(context, config)
}
@Module
@InstallIn(SingletonComponent::class)
internal abstract class NormalAccountBindings {
    @Binds internal abstract fun gateway(impl: GoTrueNormalAuthGateway): NormalAuthGateway
    @Binds internal abstract fun localCleaner(impl: NormalAccountLocalCleaner): NormalLocalCleaner
    @Binds internal abstract fun ownerSync(impl: NormalSyncRepository): NormalOwnerSync
}
private object DisabledNormalBackend : Backend {
    private fun disabled(): Nothing = throw IOException("Normal account release is not approved")
    override suspend fun account(token: String) = disabled()
    override suspend fun currentAccount(token: String) = disabled()
    override suspend fun learners(token: String) = disabled()
    override suspend fun createLearner(token: String, clientId: String) = disabled()
    override suspend fun createProfileLearner(token: String, clientId: String, kind: String, lang: String) = disabled()
    override suspend fun activateOwner(token: String, declarationVersion: String, adultConfirmed: Boolean) = disabled()
    override suspend fun catalog(token: String) = disabled()
    override suspend fun consent(token: String, learnerId: String, granted: Boolean) = disabled()
    override suspend fun append(token: String, learnerId: String, payloads: List<String>) = disabled()
    override suspend fun pull(token: String, learnerId: String, after: Long) = disabled()
}
