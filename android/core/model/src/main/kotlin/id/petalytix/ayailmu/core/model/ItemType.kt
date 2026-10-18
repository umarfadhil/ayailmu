package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The activity catalog (docs/syllabus/00_FRAMEWORK.md §2). [renderer] is the renderer that draws it in a session
 * (CR-ENG-5); a null renderer means the type never appears in a session. [evidenceCapable] false means the type
 * can never produce fresh evidence (CR-ENG-9). P6 (2026-10-17) added renderers for the v2 types except
 * `speed_round`, which is an opt-in practice mode over existing items rather than an item type of its own.
 * Follow-up 11 (2026-10-18) added `trace` (docs/content/INTERACTIONS_AUDIO.md §4); follow-up 12 added `story`
 * (docs/content/MODULES_LEVELS_STORIES.md §2).
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

    // v2 types (P6)
    @SerialName("tap_hotspot")
    TAP_HOTSPOT(Renderer.TAP_HOTSPOT),

    @SerialName("estimate_slider")
    ESTIMATE_SLIDER(Renderer.SLIDER),

    @SerialName("memory_flip")
    MEMORY_FLIP(Renderer.MEMORY_FLIP, evidenceCapable = false),

    /** A short story (reading) and a choice; drawn by the choice renderer with the reading above it. */
    @SerialName("story_choice")
    STORY_CHOICE(Renderer.CHOOSE),

    /** Not an item type: speed rounds replay existing items in an opt-in practice mode (feature/speedround). */
    @SerialName("speed_round")
    SPEED_ROUND(null, evidenceCapable = false),

    /** Home's daily puzzle (pool SPARE, never planned into sessions); answered as a choice or a number. */
    @SerialName("daily_puzzle")
    DAILY_PUZZLE(Renderer.DAILY_PUZZLE, evidenceCapable = false),

    /**
     * Trace a letter stroke by stroke (`Item.trace` names the glyph in `assets/strokes/index.json`). Answered with
     * the ids of the strokes completed; practice only, like `memory_flip` (CR-ENG-9).
     */
    @SerialName("trace")
    TRACE(Renderer.TRACE, evidenceCapable = false),

    /**
     * An animated story (`Item.storyId` names it in the pack's `stories`): 3–6 panels the learner taps through.
     * "Seen", never scored and never evidence, exactly like `info_card`; questions about it are ordinary items
     * carrying the same `story_id`.
     */
    @SerialName("story")
    STORY(Renderer.STORY, evidenceCapable = false),
    ;

    /** True when this build can draw the type in a session (name kept from P1: "has a renderer"). */
    val isV1: Boolean get() = renderer != null

    /** Renderers in the registry (feature/session). */
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
        TAP_HOTSPOT,
        SLIDER,
        MEMORY_FLIP,
        DAILY_PUZZLE,
        TRACE,
        STORY,
    }
}
