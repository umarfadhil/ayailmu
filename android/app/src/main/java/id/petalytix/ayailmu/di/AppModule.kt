package id.petalytix.ayailmu.di

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.core.billing.BillingConfig
import id.petalytix.ayailmu.core.data.AppBuildInfo
import id.petalytix.ayailmu.feature.collection.CollectionDataSource
import id.petalytix.ayailmu.feature.collection.DefaultCollectionDataSource
import id.petalytix.ayailmu.feature.collection.DefaultFiguresDataSource
import id.petalytix.ayailmu.feature.collection.FiguresDataSource
import id.petalytix.ayailmu.feature.consent.ConsentDataSource
import id.petalytix.ayailmu.feature.consent.DefaultConsentDataSource
import id.petalytix.ayailmu.feature.home.DefaultHomeDataSource
import id.petalytix.ayailmu.feature.home.HomeDataSource
import id.petalytix.ayailmu.feature.modules.DefaultModuleDataSource
import id.petalytix.ayailmu.feature.modules.ModuleDataSource
import id.petalytix.ayailmu.feature.onboarding.DefaultOnboardingDataSource
import id.petalytix.ayailmu.feature.onboarding.OnboardingDataSource
import id.petalytix.ayailmu.feature.progress.DefaultProgressDataSource
import id.petalytix.ayailmu.feature.progress.ProgressDataSource
import id.petalytix.ayailmu.feature.puzzle.DailyPuzzleDataSource
import id.petalytix.ayailmu.feature.puzzle.DefaultDailyPuzzleDataSource
import id.petalytix.ayailmu.feature.session.DefaultSessionDataSource
import id.petalytix.ayailmu.feature.session.SessionDataSource
import id.petalytix.ayailmu.feature.settings.DefaultSettingsDataSource
import id.petalytix.ayailmu.feature.settings.SettingsDataSource
import id.petalytix.ayailmu.feature.speedround.DefaultSpeedRoundDataSource
import id.petalytix.ayailmu.feature.speedround.SpeedRoundDataSource
import id.petalytix.ayailmu.feature.store.AccessSource
import id.petalytix.ayailmu.feature.store.DefaultAccessSource
import id.petalytix.ayailmu.feature.store.DefaultStoreDataSource
import id.petalytix.ayailmu.feature.store.StoreDataSource
import id.petalytix.ayailmu.feature.trial.DefaultSurveyDataSource
import id.petalytix.ayailmu.feature.trial.SurveyDataSource
import id.petalytix.ayailmu.feature.units.DefaultUnitsDataSource
import id.petalytix.ayailmu.feature.units.UnitPlayDataSource
import id.petalytix.ayailmu.feature.units.UnitsDataSource

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    fun provideBuildInfo(): AppBuildInfo = AppBuildInfo(developerDemo = BuildConfig.DEVELOPER_DEMO, appVersion = BuildConfig.VERSION_NAME)

    /** Play licence key from the build machine's Gradle properties (never committed, CR-BIL-4); empty = check skipped. */
    @Provides
    fun provideBillingConfig(): BillingConfig = BillingConfig(playLicenseKey = BuildConfig.PLAY_LICENSE_KEY)
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

    @Binds
    abstract fun bindAccessSource(impl: DefaultAccessSource): AccessSource

    @Binds
    abstract fun bindStoreDataSource(impl: DefaultStoreDataSource): StoreDataSource

    @Binds
    abstract fun bindDailyPuzzleDataSource(impl: DefaultDailyPuzzleDataSource): DailyPuzzleDataSource

    @Binds
    abstract fun bindSpeedRoundDataSource(impl: DefaultSpeedRoundDataSource): SpeedRoundDataSource

    @Binds
    abstract fun bindCollectionDataSource(impl: DefaultCollectionDataSource): CollectionDataSource

    @Binds
    abstract fun bindSurveyDataSource(impl: DefaultSurveyDataSource): SurveyDataSource

    @Binds
    abstract fun bindUnitsDataSource(impl: DefaultUnitsDataSource): UnitsDataSource

    @Binds
    abstract fun bindUnitPlayDataSource(impl: DefaultUnitsDataSource): UnitPlayDataSource

    /** Follow-up 12: the module screen (language picker, level ladder). */
    @Binds
    abstract fun bindModuleDataSource(impl: DefaultModuleDataSource): ModuleDataSource

    /** Follow-up 12: «Galeri tokoh» (Sejarah), written by APP-STORY in feature/collection/FiguresData.kt. */
    @Binds
    abstract fun bindFiguresDataSource(impl: DefaultFiguresDataSource): FiguresDataSource
}
