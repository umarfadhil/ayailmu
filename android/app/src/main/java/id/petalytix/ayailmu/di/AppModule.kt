package id.petalytix.ayailmu.di

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.feature.consent.ConsentDataSource
import id.petalytix.ayailmu.feature.consent.DefaultConsentDataSource
import id.petalytix.ayailmu.feature.home.DefaultHomeDataSource
import id.petalytix.ayailmu.feature.home.HomeDataSource
import id.petalytix.ayailmu.feature.onboarding.DefaultOnboardingDataSource
import id.petalytix.ayailmu.feature.onboarding.OnboardingDataSource
import id.petalytix.ayailmu.feature.progress.DefaultProgressDataSource
import id.petalytix.ayailmu.feature.progress.ProgressDataSource
import id.petalytix.ayailmu.feature.session.DefaultSessionDataSource
import id.petalytix.ayailmu.feature.session.SessionDataSource
import id.petalytix.ayailmu.feature.settings.DefaultSettingsDataSource
import id.petalytix.ayailmu.feature.settings.SettingsDataSource

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    fun provideBuildInfo(): AppBuildInfo = AppBuildInfo(developerDemo = BuildConfig.DEVELOPER_DEMO, appVersion = BuildConfig.VERSION_NAME)
}

/** Feature data sources: interfaces so each ViewModel is unit-tested with a fake (CR-ARC-5). */
@Module
@InstallIn(SingletonComponent::class)
abstract class AppBindings {
    @Binds
    abstract fun bindHomeDataSource(impl: DefaultHomeDataSource): HomeDataSource

    @Binds
    abstract fun bindOnboardingDataSource(impl: DefaultOnboardingDataSource): OnboardingDataSource

    @Binds
    abstract fun bindSessionDataSource(impl: DefaultSessionDataSource): SessionDataSource

    @Binds
    abstract fun bindConsentDataSource(impl: DefaultConsentDataSource): ConsentDataSource

    @Binds
    abstract fun bindProgressDataSource(impl: DefaultProgressDataSource): ProgressDataSource

    @Binds
    abstract fun bindSettingsDataSource(impl: DefaultSettingsDataSource): SettingsDataSource
}
