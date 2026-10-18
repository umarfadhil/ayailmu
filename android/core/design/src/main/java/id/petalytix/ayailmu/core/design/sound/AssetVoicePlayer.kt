package id.petalytix.ayailmu.core.design.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper

/**
 * Pronunciation clips bundled in the APK (`assets/audio/<lang>/<slug>.mp3`, INTERACTIONS_AUDIO.md §3.1), one at a
 * time through a [MediaPlayer] opened on the asset's file descriptor.
 *
 * - [has] answers from the clip keys of `assets/audio/index.json` ([setClips], read by MediaRepository in :core:data);
 *   [play] ignores any other key, so a missing clip never reaches the player and its speaker stays hidden.
 * - Media volume: USAGE_MEDIA, CONTENT_TYPE_SPEECH.
 * - Transient audio focus that lets others duck (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) for the second a clip lasts:
 *   music dips under the word instead of stopping, spoken audio that cannot duck pauses, and focus is given back as
 *   soon as the clip ends, fails or is stopped. If focus is refused (a phone call), nothing plays.
 * - [play] stops the clip already playing; each player is released on completion, on error and on [stop]. Nothing
 *   here throws, and nothing blocks: the clip is prepared asynchronously.
 * - Call from the main thread (taps and effects). The activity calls [stop] in onStop and [release] in onDestroy.
 * - Local only: no network, no permission, no SDK (CR-DAT-3, Families).
 */
class AssetVoicePlayer(
    context: Context,
) : VoicePlayer {
    private val app = context.applicationContext
    private val audioManager: AudioManager? = runCatching { app.getSystemService(AudioManager::class.java) }.getOrNull()

    @Volatile private var clips: Set<String> = emptySet()

    private var player: MediaPlayer? = null
    private var holdsFocus = false
    private var released = false

    private val focusRequest: AudioFocusRequest? =
        runCatching {
            AudioFocusRequest
                .Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(ATTRIBUTES)
                .setOnAudioFocusChangeListener({ change -> onFocusChange(change) }, Handler(Looper.getMainLooper()))
                .build()
        }.getOrNull()

    /** The clips listed in the bundled index (keys like `ko/sagwa`); empty until the index is read. */
    fun setClips(keys: Set<String>) {
        clips = keys
    }

    override fun has(clip: String): Boolean = clip in clips

    override fun play(clip: String) {
        if (released || !has(clip)) return
        stop()
        if (!requestFocus()) return
        val mp =
            try {
                MediaPlayer()
            } catch (e: Exception) {
                abandonFocus()
                return
            }
        player = mp
        try {
            mp.setAudioAttributes(ATTRIBUTES)
            app.assets.openFd(assetPath(clip)).use { fd -> mp.setDataSource(fd) }
            mp.setOnPreparedListener { prepared ->
                if (player === prepared) runCatching { prepared.start() }.onFailure { finish(prepared) }
            }
            mp.setOnCompletionListener { done -> finish(done) }
            mp.setOnErrorListener { failed, _, _ ->
                finish(failed)
                true
            }
            mp.prepareAsync()
        } catch (e: Exception) {
            // A clip listed in the index but not in the APK, or stored compressed: nothing plays, nothing crashes.
            finish(mp)
        }
    }

    override fun stop() {
        val mp = player ?: return
        player = null
        runCatching { mp.release() }
        abandonFocus()
    }

    /** The activity is going away: stop and refuse further clips. */
    fun release() {
        released = true
        stop()
    }

    /** A player that finished, failed or could not start: release it, and give focus back if it was the current one. */
    private fun finish(mp: MediaPlayer) {
        if (player === mp) {
            player = null
            abandonFocus()
        }
        runCatching { mp.release() }
    }

    private fun onFocusChange(change: Int) {
        // Another app took the speaker for good or for a while (a call, a navigation prompt): stop the clip.
        // A "may duck" loss is ducked by the system and the word keeps playing.
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) stop()
    }

    private fun requestFocus(): Boolean {
        val am = audioManager ?: return true
        val request = focusRequest ?: return true
        val result = runCatching { am.requestAudioFocus(request) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        holdsFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return holdsFocus
    }

    private fun abandonFocus() {
        if (!holdsFocus) return
        holdsFocus = false
        val am = audioManager ?: return
        val request = focusRequest ?: return
        runCatching { am.abandonAudioFocusRequest(request) }
    }

    private companion object {
        val ATTRIBUTES: AudioAttributes =
            AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

        /** `ko/sagwa` → `audio/ko/sagwa.mp3`. Keys come from the index, already checked to be `<lang>/<slug>`. */
        fun assetPath(clip: String): String = "audio/$clip.mp3"
    }
}
