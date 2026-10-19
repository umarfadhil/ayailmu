package id.petalytix.ayailmu.feature.synclab

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.petalytix.ayailmu.core.sync.Backend
import id.petalytix.ayailmu.core.sync.HttpBackend
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object SyncLabModule {
    @Provides @Singleton
    fun backend(): Backend = HttpBackend("http://127.0.0.1:8186")
}
