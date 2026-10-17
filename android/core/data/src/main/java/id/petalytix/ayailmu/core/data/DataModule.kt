package id.petalytix.ayailmu.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.core.data.db.AyaDatabase
import id.petalytix.ayailmu.core.data.export.ExportFiles
import id.petalytix.ayailmu.core.data.repo.AndroidAssetSource
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.AssetSource
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.DataResetter
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.ActiveProfileStore
import id.petalytix.ayailmu.core.data.settings.AppSettings
import id.petalytix.ayailmu.core.data.settings.AppSettingsSerializer
import id.petalytix.ayailmu.core.data.settings.DataStoreActiveProfileStore
import id.petalytix.ayailmu.core.data.settings.DataStoreReminderStore
import id.petalytix.ayailmu.core.data.settings.ReminderStore
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.engine.IdGenerator
import id.petalytix.ayailmu.core.engine.RngFactory
import id.petalytix.ayailmu.core.engine.SeededRngFactory
import id.petalytix.ayailmu.core.engine.SystemClock
import id.petalytix.ayailmu.core.engine.UuidIdGenerator
import javax.inject.Singleton

/**
 * Data-layer bindings (CR-ARC-5). `AppBuildInfo` is provided by :app. Repositories are plain classes built
 * here so tests construct them directly with an in-memory database.
 */
@Module
@InstallIn(SingletonComponent::class)
object DataModule {
    @Provides
    @Singleton
    fun provideClock(): Clock = SystemClock()

    @Provides
    @Singleton
    fun provideRngFactory(): RngFactory = SeededRngFactory

    @Provides
    @Singleton
    fun provideIds(): IdGenerator = UuidIdGenerator

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
    ): AyaDatabase =
        // No fallbackToDestructiveMigration, ever (CR-DAT-1).
        Room.databaseBuilder(context, AyaDatabase::class.java, AyaDatabase.NAME).build()

    @Provides
    @Singleton
    fun provideSettings(
        @ApplicationContext context: Context,
    ): DataStore<AppSettings> =
        DataStoreFactory.create(
            serializer = AppSettingsSerializer,
            // An unreadable settings file falls back to defaults (reminder off, no active profile) instead of
            // crashing every start; the learner data itself lives in Room and is untouched.
            corruptionHandler = ReplaceFileCorruptionHandler { AppSettings() },
            produceFile = { context.dataStoreFile("app_settings.json") },
        )

    @Provides
    @Singleton
    fun provideActiveProfileStore(store: DataStore<AppSettings>): ActiveProfileStore = DataStoreActiveProfileStore(store)

    @Provides
    @Singleton
    fun provideReminderStore(store: DataStore<AppSettings>): ReminderStore = DataStoreReminderStore(store)

    @Provides
    @Singleton
    fun provideAssetSource(
        @ApplicationContext context: Context,
    ): AssetSource = AndroidAssetSource(context)

    @Provides
    @Singleton
    fun provideContentRepository(
        assets: AssetSource,
        build: AppBuildInfo,
    ): ContentRepository = ContentRepository(assets, build)

    @Provides
    @Singleton
    fun provideProfileRepository(
        db: AyaDatabase,
        active: ActiveProfileStore,
        clock: Clock,
        ids: IdGenerator,
    ): ProfileRepository = ProfileRepository(db, active, clock, ids)

    @Provides
    @Singleton
    fun provideAnswerRepository(
        db: AyaDatabase,
        clock: Clock,
        ids: IdGenerator,
    ): AnswerRepository = AnswerRepository(db, clock, ids)

    @Provides
    @Singleton
    fun provideDataResetter(
        @ApplicationContext context: Context,
        db: AyaDatabase,
        active: ActiveProfileStore,
        reminders: ReminderStore,
    ): DataResetter = DataResetter(db, active, reminders) { ExportFiles.clear(context) }
}
