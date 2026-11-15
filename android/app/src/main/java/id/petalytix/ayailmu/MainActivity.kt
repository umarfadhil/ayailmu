package id.petalytix.ayailmu

import android.media.AudioManager
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dagger.hilt.android.AndroidEntryPoint
import id.petalytix.ayailmu.core.billing.EntitlementRepository
import id.petalytix.ayailmu.core.content.StrokeIndex
import id.petalytix.ayailmu.core.data.repo.MediaRepository
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.data.settings.SoundSettingsStore
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.sound.AssetVoicePlayer
import id.petalytix.ayailmu.core.design.sound.LocalSoundFx
import id.petalytix.ayailmu.core.design.sound.LocalVoice
import id.petalytix.ayailmu.core.design.sound.SilentVoice
import id.petalytix.ayailmu.core.design.sound.SoundPoolSoundFx
import id.petalytix.ayailmu.core.design.sound.SwitchableSoundFx
import id.petalytix.ayailmu.core.design.sound.VoicePlayer
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.feature.session.interact.LocalStrokes
import id.petalytix.ayailmu.navigation.AyaNavHost
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * AppCompatActivity (not ComponentActivity) so per-app language works on Android 8–12 (CR-I18N-2).
 *
 * Sound (follow-up 11, INTERACTIONS_AUDIO.md §3) is owned here and handed to every screen through composition
 * locals: [LocalSoundFx] (short effects, silent while «Efek suara» is off), [LocalVoice] (pronunciation clips) and
 * [LocalStrokes] (stroke data for `trace` items). The players are built from the application context, so the activity
 * is never leaked; the voice stops in onStop (and gives back audio focus), and both players are released in onDestroy.
 * A recreated activity (rotation, a language change) builds new ones; reloading eleven tiny effects is cheap, and
 * nothing keeps audio resources alive once the app's last screen is gone.
 */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    @Inject lateinit var profiles: ProfileRepository

    @Inject lateinit var entitlements: EntitlementRepository

    @Inject lateinit var media: MediaRepository

    @Inject lateinit var soundSettings: SoundSettingsStore

    private var effects: SoundPoolSoundFx? = null
    private var voice: AssetVoicePlayer? = null

    /** «Efek suara», as stored. Off until the setting is read, so a learner who turned it off never hears a first click. */
    @Volatile private var soundOn = false

    /** The voice is offered to screens once the clip index is read (until then every speaker stays hidden). */
    private var voiceReady by mutableStateOf(false)

    private var strokes by mutableStateOf(StrokeIndex())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Effects and clips use the media stream; the volume keys inside the app turn that one, even between sounds.
        volumeControlStream = AudioManager.STREAM_MUSIC
        val pool = SoundPoolSoundFx(applicationContext).also { effects = it }
        val speaker = AssetVoicePlayer(applicationContext).also { voice = it }
        val soundFx = SwitchableSoundFx(pool) { soundOn }

        // The active profile's language drives the whole app. No active profile = follow the system.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                profiles
                    .observeActive()
                    .map { it?.lang }
                    .filterNotNull()
                    .distinctUntilChanged()
                    .collect { AppLocale.apply(it) }
            }
        }

        // Ask Play for the live purchases on every return to the app (refunds, pending payments completed at a
        // minimarket, a purchase on another device). Offline keeps the cached entitlements (CR-BIL-3).
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                runCatching { entitlements.refresh() }
            }
        }

        // «Efek suara» (device-level). An unreadable settings file keeps the default: on.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                soundSettings.soundEffects
                    .catch { emit(true) }
                    .collect { soundOn = it }
            }
        }

        // The media indexes are read once per process (MediaRepository); a missing or broken file means none yet.
        lifecycleScope.launch {
            speaker.setClips(media.audio().clips)
            voiceReady = true
            strokes = media.strokes()
        }

        setContent {
            val voicePlayer: VoicePlayer = if (voiceReady) speaker else SilentVoice
            CompositionLocalProvider(
                LocalSoundFx provides soundFx,
                LocalVoice provides voicePlayer,
                LocalStrokes provides strokes,
            ) {
                AyaTheme {
                    PaperBackground {
                        AyaNavHost()
                    }
                }
            }
        }
    }

    override fun onStop() {
        // Leaving the app (or the screen turning off) cuts a clip short and gives audio focus back.
        voice?.stop()
        super.onStop()
    }

    override fun onDestroy() {
        effects?.release()
        voice?.release()
        effects = null
        voice = null
        super.onDestroy()
    }
}
