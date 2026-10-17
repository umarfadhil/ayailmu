package id.petalytix.ayailmu.feature.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.engine.Clock
import id.petalytix.ayailmu.core.model.Lang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale
import javax.inject.Inject

/** What onboarding needs from the data layer (an interface so the age rules are unit-tested without Room). */
interface OnboardingDataSource {
    /** The active profile, which becomes the creator of a child profile; null on first run. */
    suspend fun creator(): Profile?

    suspend fun create(
        label: String,
        kind: ProfileKind,
        lang: Lang,
        birthYear: Int,
        createdBy: String?,
    )

    fun currentYear(): Int
}

class DefaultOnboardingDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val clock: Clock,
    ) : OnboardingDataSource {
        override suspend fun creator(): Profile? = profiles.activeProfile()

        override suspend fun create(
            label: String,
            kind: ProfileKind,
            lang: Lang,
            birthYear: Int,
            createdBy: String?,
        ) {
            profiles.create(label = label, kind = kind, lang = lang, birthYear = birthYear, createdBy = createdBy, makeActive = true)
        }

        override fun currentYear(): Int = clock.today().year
    }

enum class OnboardingStep { LANGUAGE, AGE, GUARDIAN, NAME }

data class OnboardingUiState(
    val loading: Boolean = true,
    /** No profile exists yet: show the welcome text and apply the language immediately. */
    val firstRun: Boolean = true,
    val step: OnboardingStep = OnboardingStep.LANGUAGE,
    val lang: Lang = Lang.ID,
    /** True once the learner tapped a language (only then does the app switch language on first run). */
    val langPicked: Boolean = false,
    val years: List<Int> = emptyList(),
    /** Neutral age screen: nothing is preselected (Play Families policy). */
    val birthYear: Int? = null,
    val name: String = "",
    val creatorLabel: String? = null,
    val busy: Boolean = false,
    val error: Boolean = false,
    val done: Boolean = false,
) {
    val willBeChild: Boolean get() = birthYear?.let { OnboardingRules.kindFor(it, years.firstOrNull() ?: it) == ProfileKind.ANAK } ?: false
    val stepNumber: Int
        get() =
            when (step) {
                OnboardingStep.LANGUAGE -> 1
                OnboardingStep.AGE, OnboardingStep.GUARDIAN -> 2
                OnboardingStep.NAME -> 3
            }
    val canContinue: Boolean
        get() =
            !busy &&
                when (step) {
                    OnboardingStep.LANGUAGE -> true
                    OnboardingStep.AGE -> birthYear != null
                    OnboardingStep.GUARDIAN -> false
                    OnboardingStep.NAME -> name.isNotBlank()
                }

    companion object {
        const val STEPS = 3
        const val NAME_MAX = 24
    }
}

sealed interface OnboardingEvent {
    data class PickLang(
        val lang: Lang,
    ) : OnboardingEvent

    data class PickYear(
        val year: Int,
    ) : OnboardingEvent

    data class NameChanged(
        val text: String,
    ) : OnboardingEvent

    data object Next : OnboardingEvent

    data object Back : OnboardingEvent
}

/**
 * Age rule (Play Families policy, CR-DAT-5). A birth year only bounds the age to two values, so we take the
 * lower one: anyone who could still be 12 gets a child profile. 13+ (by that bound) gets an adult profile.
 */
object OnboardingRules {
    const val ADULT_MIN_AGE = 13
    const val YEARS_BACK = 100

    fun kindFor(
        birthYear: Int,
        currentYear: Int,
    ): ProfileKind = if (currentYear - birthYear - 1 >= ADULT_MIN_AGE) ProfileKind.ADULT else ProfileKind.ANAK
}

@HiltViewModel
class OnboardingViewModel
    @Inject
    constructor(
        private val data: OnboardingDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow(OnboardingUiState())
        val state: StateFlow<OnboardingUiState> = _state.asStateFlow()
        private var creator: Profile? = null

        init {
            viewModelScope.launch {
                val c = runCatching { data.creator() }.getOrNull()
                creator = c
                val year = data.currentYear()
                _state.update {
                    it.copy(
                        loading = false,
                        firstRun = c == null,
                        lang = c?.lang ?: Lang.fromTag(Locale.getDefault().language),
                        years = (year downTo year - OnboardingRules.YEARS_BACK).toList(),
                        creatorLabel = c?.label,
                    )
                }
            }
        }

        /** True when system Back should be handled here (otherwise the route cancels or the app closes). */
        val canGoBack: Boolean get() = _state.value.step != OnboardingStep.LANGUAGE

        fun onEvent(event: OnboardingEvent) {
            when (event) {
                is OnboardingEvent.PickLang -> _state.update { it.copy(lang = event.lang, langPicked = true) }
                is OnboardingEvent.PickYear -> _state.update { it.copy(birthYear = event.year) }
                is OnboardingEvent.NameChanged -> _state.update { it.copy(name = event.text.take(OnboardingUiState.NAME_MAX), error = false) }
                OnboardingEvent.Back -> _state.update { it.copy(step = previous(it.step), error = false) }
                OnboardingEvent.Next -> next()
            }
        }

        private fun previous(step: OnboardingStep) =
            when (step) {
                OnboardingStep.LANGUAGE, OnboardingStep.AGE -> OnboardingStep.LANGUAGE
                OnboardingStep.GUARDIAN, OnboardingStep.NAME -> OnboardingStep.AGE
            }

        private fun next() {
            val s = _state.value
            if (!s.canContinue) return
            when (s.step) {
                OnboardingStep.LANGUAGE -> _state.update { it.copy(step = OnboardingStep.AGE) }
                OnboardingStep.AGE -> {
                    val year = s.birthYear ?: return
                    val child = OnboardingRules.kindFor(year, s.years.first()) == ProfileKind.ANAK
                    val adultCreator = creator?.takeIf { it.kind == ProfileKind.ADULT }
                    // A child profile is only ever created by an adult profile on this device (CR-DAT-5).
                    _state.update { it.copy(step = if (child && adultCreator == null) OnboardingStep.GUARDIAN else OnboardingStep.NAME) }
                }
                OnboardingStep.GUARDIAN -> Unit
                OnboardingStep.NAME -> create(s)
            }
        }

        private fun create(s: OnboardingUiState) {
            val year = s.birthYear ?: return
            val kind = OnboardingRules.kindFor(year, s.years.first())
            _state.update { it.copy(busy = true, error = false) }
            viewModelScope.launch {
                try {
                    data.create(
                        label = s.name.trim(),
                        kind = kind,
                        lang = s.lang,
                        birthYear = year,
                        createdBy = if (kind == ProfileKind.ANAK) creator?.id else null,
                    )
                    _state.update { it.copy(busy = false, done = true) }
                } catch (e: Exception) {
                    _state.update { it.copy(busy = false, error = true) }
                }
            }
        }
    }
