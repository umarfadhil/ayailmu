package id.petalytix.ayailmu.core.design.sound

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Sound effects (docs/content/INTERACTIONS_AUDIO.md §3.2). Each one is `res/raw/<key>.ogg` in :core:design,
 * a Claude-made DRAFT a sound designer may replace under the same name. Screens never load sounds themselves:
 * they call [SoundFx.play] through [LocalSoundFx], which the app provides (silent when the switch is off).
 */
enum class Sfx(
    val key: String,
) {
    TAP("sfx_tap"),
    PICK("sfx_pick"),
    DROP("sfx_drop"),
    SNAP("sfx_snap"),
    CONNECT("sfx_connect"),
    CORRECT("sfx_correct"),
    NOT_YET("sfx_not_yet"),
    STROKE("sfx_stroke"),
    STICKER("sfx_sticker"),
    SESSION_DONE("sfx_session_done"),
    PAGE("sfx_page"),
}

/** Plays short effects. Implementations never throw and never block the caller. */
interface SoundFx {
    fun play(sfx: Sfx)
}

/** Previews, tests and "Efek suara: off". */
object SilentSoundFx : SoundFx {
    override fun play(sfx: Sfx) = Unit
}

/**
 * Pronunciation clips (`assets/audio/<lang>/<slug>.mp3`, keys like `ko/sagwa`, §3.1). [has] is false for a clip
 * that is not bundled yet: callers hide the speaker button, and the session leaves out items that need it.
 */
interface VoicePlayer {
    fun has(clip: String): Boolean

    /** Plays [clip], stopping any clip already playing. Does nothing when the clip is missing. */
    fun play(clip: String)

    fun stop()
}

object SilentVoice : VoicePlayer {
    override fun has(clip: String): Boolean = false

    override fun play(clip: String) = Unit

    override fun stop() = Unit
}

val LocalSoundFx = staticCompositionLocalOf<SoundFx> { SilentSoundFx }

val LocalVoice = staticCompositionLocalOf<VoicePlayer> { SilentVoice }
