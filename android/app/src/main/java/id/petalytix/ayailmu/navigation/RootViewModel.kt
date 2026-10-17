package id.petalytix.ayailmu.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** What the app root shows: nothing yet, first-run onboarding, or the normal navigation graph. */
sealed interface RootState {
    data object Loading : RootState

    /** [attempt] changes every time onboarding is shown again (e.g. after "delete all data"), so it starts fresh. */
    data class NeedsProfile(
        val attempt: Int,
    ) : RootState

    data object Ready : RootState
}

@HiltViewModel
class RootViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
    ) : ViewModel() {
        private enum class Kind { READY, NEEDS_PROFILE, ADOPT }

        private var attempts = 0

        val state: StateFlow<RootState> =
            combine(profiles.observeActive(), profiles.observeProfiles()) { active, all ->
                when {
                    active != null -> Kind.READY to null
                    all.isNotEmpty() -> Kind.ADOPT to all.first().id
                    else -> Kind.NEEDS_PROFILE to null
                }
            }.onEach { (kind, adoptId) ->
                // Profiles exist but none is active (rare: an interrupted delete). Pick the oldest instead of onboarding again.
                if (kind == Kind.ADOPT && adoptId != null) runCatching { profiles.setActive(adoptId) }
            }.map { it.first }
                .distinctUntilChanged()
                .map { kind ->
                    when (kind) {
                        Kind.READY -> RootState.Ready
                        Kind.ADOPT -> RootState.Loading
                        Kind.NEEDS_PROFILE -> RootState.NeedsProfile(++attempts)
                    }
                }.stateIn(viewModelScope, SharingStarted.Eagerly, RootState.Loading)
    }
