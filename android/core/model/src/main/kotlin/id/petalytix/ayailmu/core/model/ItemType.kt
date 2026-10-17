package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The activity catalog (docs/syllabus/00_FRAMEWORK.md §2). [renderer] is the v1 renderer that draws it
 * (CR-ENG-5); types whose renderer is null need a new renderer in P6. [evidenceCapable] false means the
 * type can never produce fresh evidence (CR-ENG-9).
 */
@Serializable
enum class ItemType(
    val renderer: Renderer?,
    val evidenceCapable: Boolean = true,
) {
    @SerialName("choose")
    CHOOSE(Renderer.CHOOSE),

    @SerialName("pick_image")
    PICK_IMAGE(Renderer.CHOOSE),

    @SerialName("true_false")
    TRUE_FALSE(Renderer.CHOOSE),

    @SerialName("type_in")
    TYPE_IN(Renderer.TYPE_IN),

    @SerialName("number_input")
    NUMBER_INPUT(Renderer.NUMBER_INPUT),

    @SerialName("fill_blank")
    FILL_BLANK(Renderer.TILES),

    @SerialName("tiles")
    TILES(Renderer.TILES),

    @SerialName("order")
    ORDER(Renderer.ORDER),

    @SerialName("match_pairs")
    MATCH_PAIRS(Renderer.MATCH_PAIRS),

    @SerialName("sort_buckets")
    SORT_BUCKETS(Renderer.MATCH_PAIRS),

    @SerialName("audio_match")
    AUDIO_MATCH(Renderer.AUDIO_MATCH),

    @SerialName("mini_reading")
    MINI_READING(Renderer.MINI_READING),

    @SerialName("info_card")
    INFO_CARD(Renderer.INFO_CARD, evidenceCapable = false),

    // v2 renderers (P6)
    @SerialName("tap_hotspot")
    TAP_HOTSPOT(null),

    @SerialName("estimate_slider")
    ESTIMATE_SLIDER(null),

    @SerialName("memory_flip")
    MEMORY_FLIP(null, evidenceCapable = false),

    @SerialName("story_choice")
    STORY_CHOICE(null),

    @SerialName("speed_round")
    SPEED_ROUND(null, evidenceCapable = false),

    @SerialName("daily_puzzle")
    DAILY_PUZZLE(null, evidenceCapable = false),
    ;

    val isV1: Boolean get() = renderer != null

    /** Renderers that exist in the v1 registry (feature/session, P3). */
    enum class Renderer {
        CHOOSE,
        TYPE_IN,
        NUMBER_INPUT,
        TILES,
        ORDER,
        MATCH_PAIRS,
        AUDIO_MATCH,
        MINI_READING,
        INFO_CARD,
    }
}
