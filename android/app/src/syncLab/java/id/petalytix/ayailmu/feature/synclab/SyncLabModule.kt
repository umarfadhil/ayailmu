package id.petalytix.ayailmu.feature.synclab

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.core.data.repo.AllowAllProfiles
import id.petalytix.ayailmu.core.data.repo.ProfileVisibility
import id.petalytix.ayailmu.feature.settings.NormalLocalCleaner
import id.petalytix.ayailmu.feature.settings.NoNormalLocalCleaner
import id.petalytix.ayailmu.core.sync.Backend
import id.petalytix.ayailmu.core.sync.GoTrueAuth
import id.petalytix.ayailmu.core.sync.HttpBackend
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object SyncLabModule {
    private fun endpoints() = SyncLabEndpoints.forPublicOrigin(BuildConfig.SYNC_LAB_PUBLIC_ORIGIN)

    @Provides @Singleton
    fun normalLocalCleaner(): NormalLocalCleaner = NoNormalLocalCleaner
    @Provides @Singleton
    fun profileVisibility(): ProfileVisibility = AllowAllProfiles
    @Provides @Singleton
    fun backend(): Backend = HttpBackend(endpoints().api)
    @Provides @Singleton
    fun authApi(): GoTrueAuth = GoTrueAuth(endpoints().auth)
    @Provides @Singleton
    internal fun authVault(@ApplicationContext context: Context): AuthVault = KeystoreAuthVault(context)
}
