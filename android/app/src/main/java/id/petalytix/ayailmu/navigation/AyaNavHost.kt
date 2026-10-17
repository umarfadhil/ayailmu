package id.petalytix.ayailmu.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import id.petalytix.ayailmu.feature.consent.ConsentRoute
import id.petalytix.ayailmu.feature.home.HomeNav
import id.petalytix.ayailmu.feature.home.HomeRoute
import id.petalytix.ayailmu.feature.onboarding.OnboardingRoute
import id.petalytix.ayailmu.feature.onboarding.OnboardingViewModel
import id.petalytix.ayailmu.feature.progress.ProgressRoute
import id.petalytix.ayailmu.feature.session.SessionRoute
import id.petalytix.ayailmu.feature.settings.SettingsRoute
import kotlinx.serialization.Serializable

/**
 * Type-safe routes (CR-ARC-6). First-run onboarding is not a route: the root shows it whenever no profile
 * exists, so "delete all data" (or deleting the last profile) lands there too. The store route follows in P5.
 */
sealed interface AyaRoute {
    @Serializable
    data object Home : AyaRoute

    /** [track] is the catalog track id ("arab", "mat"); read back by SessionViewModel from SavedStateHandle. */
    @Serializable
    data class Session(
        val track: String,
    ) : AyaRoute

    @Serializable
    data object AddProfile : AyaRoute

    @Serializable
    data object Settings : AyaRoute

    @Serializable
    data class Progress(
        val track: String,
    ) : AyaRoute

    /** Trial consent before an evidence track (Arabic); on accept it is replaced by the session. */
    @Serializable
    data class Consent(
        val track: String,
    ) : AyaRoute
}

@Composable
fun AyaNavHost(root: RootViewModel = hiltViewModel()) {
    val state by root.state.collectAsStateWithLifecycle()
    when (val s = state) {
        RootState.Loading -> Box(Modifier.fillMaxSize())
        is RootState.NeedsProfile -> {
            val vm: OnboardingViewModel = hiltViewModel(key = "first-run-${s.attempt}")
            OnboardingRoute(onDone = {}, onCancel = null, viewModel = vm)
        }
        RootState.Ready -> ReadyGraph()
    }
}

@Composable
private fun ReadyGraph() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = AyaRoute.Home) {
        composable<AyaRoute.Home> {
            HomeRoute(
                nav =
                    HomeNav(
                        openTrack = { card ->
                            val route: AyaRoute = if (card.needsConsent) AyaRoute.Consent(card.track) else AyaRoute.Session(card.track)
                            navController.navigate(route) { launchSingleTop = true }
                        },
                        openProgress = { track -> navController.navigate(AyaRoute.Progress(track)) { launchSingleTop = true } },
                        openSettings = { navController.navigate(AyaRoute.Settings) { launchSingleTop = true } },
                        addProfile = { navController.navigate(AyaRoute.AddProfile) { launchSingleTop = true } },
                    ),
            )
        }
        composable<AyaRoute.Session> { entry ->
            val track = entry.toRoute<AyaRoute.Session>().track
            SessionRoute(
                onExit = { navController.popBackStack(AyaRoute.Home, inclusive = false) },
                onConsent = {
                    navController.navigate(AyaRoute.Consent(track)) {
                        popUpTo(AyaRoute.Home) { inclusive = false }
                    }
                },
            )
        }
        composable<AyaRoute.Consent> {
            ConsentRoute(
                onAccepted = { track ->
                    navController.navigate(AyaRoute.Session(track)) {
                        popUpTo(AyaRoute.Home) { inclusive = false }
                    }
                },
                onBack = { navController.popBackStack() },
            )
        }
        composable<AyaRoute.Progress> {
            ProgressRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.Settings> {
            SettingsRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.AddProfile> {
            OnboardingRoute(
                onDone = { navController.popBackStack(AyaRoute.Home, inclusive = false) },
                onCancel = { navController.popBackStack() },
            )
        }
    }
}
