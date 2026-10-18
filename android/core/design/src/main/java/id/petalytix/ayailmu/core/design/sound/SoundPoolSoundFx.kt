package id.petalytix.ayailmu.core.design.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import id.petalytix.ayailmu.core.design.R
import java.util.concurrent.ConcurrentHashMap

/**
 * The short effects (`res/raw/sfx_*.ogg`, INTERACTIONS_AUDIO.md §3.2) through one [SoundPool].
 *
 * - USAGE_GAME, not USAGE_ASSISTANCE_SONIFICATION: game sounds are routed to the media stream, so the media volume
 *   (the volume keys inside the app) applies, as the contract asks. Sonification goes to the system stream on most
 *   phones, which a learner would not find or expect.
 * - No audio focus: effects last at most 600 ms and mix over whatever is playing (Android guidance for short game
 *   effects). Only voice clips ask for transient focus ([AssetVoicePlayer]).
 * - Every effect is loaded once, in the background, when this is created. An effect plays only after its load has
 *   finished: the first taps after start may be silent, never late. [play] never throws and never blocks.
 * - Local only: bundled files, no network, no permission, no SDK (CR-DAT-3, Families).
 *
 * Owned by the activity (created in onCreate from the application context, [release]d in onDestroy).
 */
class SoundPoolSoundFx(
    context: Context,
) : SoundFx {
    private val pool: SoundPool? =
        runCatching {
            SoundPool
                .Builder()
                .setMaxStreams(MAX_STREAMS)
                .setAudioAttributes(ATTRIBUTES)
                .build()
        }.getOrNull()

    /** Sample ids that finished loading (the listener runs on the main looper, play on the main thread). */
    private val loaded: MutableSet<Int> = ConcurrentHashMap.newKeySet()

    private val samples: Map<Sfx, Int>

    @Volatile private var released = false

    init {
        pool?.setOnLoadCompleteListener { _, sampleId, status -> if (status == 0) loaded += sampleId }
        val app = context.applicationContext
        samples =
            Sfx.entries
                .mapNotNull { sfx ->
                    val id = runCatching { pool?.load(app, rawOf(sfx), 1) }.getOrNull()
                    if (id != null && id != 0) sfx to id else null
                }.toMap()
    }

    override fun play(sfx: Sfx) {
        if (released) return
        val p = pool ?: return
        val id = samples[sfx] ?: return
        if (id !in loaded) return
        runCatching { p.play(id, VOLUME, VOLUME, PRIORITY, NO_LOOP, RATE) }
    }

    /** Frees the pool; afterwards [play] does nothing. */
    fun release() {
        if (released) return
        released = true
        runCatching { pool?.release() }
    }

    private companion object {
        /** A drop, a snap and «betul» can overlap; more than that is noise. */
        const val MAX_STREAMS = 4
        const val VOLUME = 1f
        const val PRIORITY = 1
        const val NO_LOOP = 0
        const val RATE = 1f

        val ATTRIBUTES: AudioAttributes =
            AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

        /** Exhaustive on purpose: a new [Sfx] without its file does not compile. */
        fun rawOf(sfx: Sfx): Int =
            when (sfx) {
                Sfx.TAP -> R.raw.sfx_tap
                Sfx.PICK -> R.raw.sfx_pick
                Sfx.DROP -> R.raw.sfx_drop
                Sfx.SNAP -> R.raw.sfx_snap
                Sfx.CONNECT -> R.raw.sfx_connect
                Sfx.CORRECT -> R.raw.sfx_correct
                Sfx.NOT_YET -> R.raw.sfx_not_yet
                Sfx.STROKE -> R.raw.sfx_stroke
                Sfx.STICKER -> R.raw.sfx_sticker
                Sfx.SESSION_DONE -> R.raw.sfx_session_done
                Sfx.PAGE -> R.raw.sfx_page
            }
    }
}
