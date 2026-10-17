package id.petalytix.ayailmu

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dagger.hilt.android.AndroidEntryPoint
import id.petalytix.ayailmu.core.data.repo.ProfileRepository
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.navigation.AyaNavHost
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** AppCompatActivity (not ComponentActivity) so per-app language works on Android 8–12 (CR-I18N-2). */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    @Inject lateinit var profiles: ProfileRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

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

        setContent {
            AyaTheme {
                PaperBackground {
                    AyaNavHost()
                }
            }
        }
    }
}
