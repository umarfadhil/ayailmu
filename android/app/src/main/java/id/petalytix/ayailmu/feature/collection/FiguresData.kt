package id.petalytix.ayailmu.feature.collection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.data.repo.AnswerRepository
import id.petalytix.ayailmu.core.data.repo.ContentRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.feature.home.fits
import id.petalytix.ayailmu.feature.session.story.StorySeen
import id.petalytix.ayailmu.feature.session.story.StoryUi
import id.petalytix.ayailmu.feature.session.story.StoryUiMapper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One person in the «Tokoh Sejarah» gallery: the story about them, resolved for the profile's language, and
 * whether this profile has met them (seen the story). Figures not met yet are shown faintly, never as locked.
 */
data class FigureUi(
    val story: StoryUi,
    val met: Boolean,
) {
    val storyId: String get() = story.storyId
    val name: String get() = story.name
    val years: String? get() = story.years

    /** The picture of their work (the story's emblem, else its first scene). */
    val art: String? get() = story.emblemOrScene
}

/** One track's visible content and this profile's answer events on it. */
data class TrackStories(
    val content: GatedContent,
    val history: List<AnswerEvent>,
)

/**
 * Pure rules for the figure gallery (follow-up 12). Like the gem box, it is recomputed from answer events
 * (CR-ENG-11): a figure is met once the `story` item that plays their story has an answer event ("seen").
 * Every story of the given tracks is listed once (by story id, first track wins), in track order and then in the
 * order the units play them; locked units' figures are listed too, as not met yet.
 */
object FigureGallery {
    fun figures(
        tracks: List<TrackStories>,
        lang: Lang,
    ): List<FigureUi> {
        val out = LinkedHashMap<String, FigureUi>()
        for (t in tracks) {
            val seen = StorySeen.storyIds(t.content.items, t.history)
            val storyItems =
                t.content.items
                    .filter { it.isStory && !it.storyId.isNullOrBlank() }
                    .sortedWith(compareBy({ it.unit }, { it.order ?: Int.MAX_VALUE }, { it.itemId }))
            for (item in storyItems) {
                val id = item.storyId ?: continue
                val story = t.content.story(id) ?: continue
                val met = id in seen
                val known = out[id]
                when {
                    known == null -> out[id] = FigureUi(StoryUiMapper.map(id, story, lang), met)
                    met && !known.met -> out[id] = known.copy(met = true)
                }
            }
        }
        return out.values.toList()
    }

    fun metCount(figures: List<FigureUi>): Int = figures.count { it.met }
}

/** What the gallery needs from the data layer; an interface so the ViewModel is tested with a fake. */
fun interface FiguresDataSource {
    /** Null when there is no active profile. */
    suspend fun figures(): List<FigureUi>?
}

/**
 * The profile's Sejarah tracks (its audience and language, every level, Pemula first), their stories and the
 * profile's answers on each. Bound in di/AppModule (AppBindings).
 */
class DefaultFiguresDataSource
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val content: ContentRepository,
        private val answers: AnswerRepository,
    ) : FiguresDataSource {
        override suspend fun figures(): List<FigureUi>? {
            val profile = profiles.activeProfile() ?: return null
            val tracks =
                content
                    .tracks()
                    .filter { it.pack.meta.subject == Subject.SEJARAH && it.fits(profile) }
                    .sortedBy { it.pack.meta.level.ordinal }
            return FigureGallery.figures(tracks.map { TrackStories(it.content, answers.history(profile.id, it.track)) }, profile.lang)
        }
    }

sealed interface FiguresUiState {
    data object Loading : FiguresUiState

    data object Failed : FiguresUiState

    data class Ready(
        val figures: List<FigureUi>,
    ) : FiguresUiState {
        val met: Int get() = FigureGallery.metCount(figures)
    }
}

@HiltViewModel
class FiguresViewModel
    @Inject
    constructor(
        private val data: FiguresDataSource,
    ) : ViewModel() {
        private val _state = MutableStateFlow<FiguresUiState>(FiguresUiState.Loading)
        val state: StateFlow<FiguresUiState> = _state.asStateFlow()

        init {
            viewModelScope.launch {
                _state.value =
                    try {
                        data.figures()?.let { FiguresUiState.Ready(it) } ?: FiguresUiState.Failed
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        FiguresUiState.Failed
                    }
            }
        }
    }
