package id.petalytix.ayailmu.feature.collection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.UnitInfo
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ChallengeRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.home.fits
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A collected hidden gem (framework §1b): the card text and where it comes from. */
data class GemUi(
    val itemId: String,
    val text: String,
    val source: String?,
    val subjectTitle: String,
)

/** One sticker: earned by finishing the unit challenge (which opens once the unit's practice is done). */
data class StickerUi(
    val unit: String,
    val unitTitle: String,
    val key: String,
    val earned: Boolean,
)

data class StickerShelf(
    val trackTitle: String,
    val stickers: List<StickerUi>,
    /** Casual tracks also draw their stickers as the «Kebun Ilmu» garden. */
    val garden: Boolean = true,
    /** Follow-up 12: the track's module, drawn as its cover beside the title (never a text-only header). */
    val subject: Subject? = null,
)

/**
 * Pure rules for the two collections (P6). Gems are recomputed from answer events (CR-ENG-11). Stickers come
 * from finished unit challenges (`unit_challenges`), and the challenge opens once every practice question of
 * the unit was answered, whatever the result ("I don't know yet" too). No scores, no pass mark.
 */
object Collections {
    fun gems(
        content: GatedContent,
        history: List<AnswerEvent>,
        lang: Lang,
        subjectTitle: String,
    ): List<GemUi> {
        val seen = history.filter { it.gem }.map { it.itemId }.distinct()
        return seen.mapNotNull { id ->
            val item = content.itemOrNull(id) ?: return@mapNotNull null
            val text = item.modelAnswer?.resolve(lang) ?: return@mapNotNull null
            GemUi(itemId = id, text = text, source = item.source, subjectTitle = subjectTitle)
        }
    }

    /** [completed]: units whose challenge this profile finished on this track. */
    fun stickers(
        units: List<UnitInfo>,
        lang: Lang,
        completed: Set<String>,
    ): List<StickerUi> =
        units.mapNotNull { u ->
            val key = u.sticker ?: return@mapNotNull null
            StickerUi(unit = u.unit, unitTitle = u.title.resolve(lang), key = key, earned = u.unit in completed)
        }
}

interface CollectionDataSource {
    /** Null when there is no active profile. */
    suspend fun gems(): List<GemUi>?

    suspend fun stickers(): List<StickerShelf>?
}

class DefaultCollectionDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
        private val challenges: ChallengeRepository,
    ) : CollectionDataSource {
        override suspend fun gems(): List<GemUi>? {
            val profile = profiles.activeProfile() ?: return null
            // Every track the profile ever answered in, not only today's shelf (a language switch keeps gems).
            return content.tracks().flatMap { t ->
                val history = answers.history(profile.id, t.track)
                if (history.isEmpty()) emptyList() else Collections.gems(t.content, history, profile.lang, t.pack.meta.title.resolve(profile.lang))
            }
        }

        override suspend fun stickers(): List<StickerShelf>? {
            val profile = profiles.activeProfile() ?: return null
            val done = challenges.forProfile(profile.id)
            return content.tracks().filter { it.fits(profile) && it.pack.units.any { u -> u.sticker != null } }.map { t ->
                StickerShelf(
                    trackTitle = t.pack.meta.title.resolve(profile.lang),
                    stickers = Collections.stickers(t.pack.units, profile.lang, done.filter { it.track == t.track }.map { it.unit }.toSet()),
                    garden = t.rules.mode == TrackMode.CASUAL,
                    subject = t.pack.meta.subject,
                )
            }
        }
    }

sealed interface CollectionUiState<out T> {
    data object Loading : CollectionUiState<Nothing>

    data object Failed : CollectionUiState<Nothing>

    data class Ready<T>(
        val value: T,
    ) : CollectionUiState<T>
}

@HiltViewModel
class GemBoxViewModel
    @Inject
    constructor(
        private val data: CollectionDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow<CollectionUiState<List<GemUi>>>(CollectionUiState.Loading)
        val state: StateFlow<CollectionUiState<List<GemUi>>> = _state.asStateFlow()

        init {
            viewModelScope.launch {
                _state.value =
                    try {
                        data.gems()?.let { CollectionUiState.Ready(it) } ?: CollectionUiState.Failed
                    } catch (e: Exception) {
                        CollectionUiState.Failed
                    }
            }
        }
    }

@HiltViewModel
class StickerShelfViewModel
    @Inject
    constructor(
        private val data: CollectionDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow<CollectionUiState<List<StickerShelf>>>(CollectionUiState.Loading)
        val state: StateFlow<CollectionUiState<List<StickerShelf>>> = _state.asStateFlow()

        init {
            viewModelScope.launch {
                _state.value =
                    try {
                        data.stickers()?.let { CollectionUiState.Ready(it) } ?: CollectionUiState.Failed
                    } catch (e: Exception) {
                        CollectionUiState.Failed
                    }
            }
        }
    }
