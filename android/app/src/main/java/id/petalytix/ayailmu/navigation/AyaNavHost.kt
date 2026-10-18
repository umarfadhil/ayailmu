package id.petalytix.ayailmu.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import id.petalytix.ayailmu.feature.collection.FiguresRoute
import id.petalytix.ayailmu.feature.collection.GemBoxRoute
import id.petalytix.ayailmu.feature.collection.StickerShelfRoute
import id.petalytix.ayailmu.feature.consent.ConsentRoute
import id.petalytix.ayailmu.feature.home.HomeNav
import id.petalytix.ayailmu.feature.home.HomeRoute
import id.petalytix.ayailmu.feature.modules.ModuleCard
import id.petalytix.ayailmu.feature.modules.ModuleNav
import id.petalytix.ayailmu.feature.modules.ModuleRoute
import id.petalytix.ayailmu.feature.onboarding.OnboardingRoute
import id.petalytix.ayailmu.feature.onboarding.OnboardingViewModel
import id.petalytix.ayailmu.feature.progress.ProgressNav
import id.petalytix.ayailmu.feature.progress.ProgressRoute
import id.petalytix.ayailmu.feature.puzzle.DailyPuzzleRoute
import id.petalytix.ayailmu.feature.session.SessionRoute
import id.petalytix.ayailmu.feature.settings.SettingsRoute
import id.petalytix.ayailmu.feature.speedround.SpeedRoundRoute
import id.petalytix.ayailmu.feature.store.StoreRoute
import id.petalytix.ayailmu.feature.trial.SurveyKind
import id.petalytix.ayailmu.feature.trial.SurveyRoute
import id.petalytix.ayailmu.feature.units.UnitChallengeRoute
import id.petalytix.ayailmu.feature.units.UnitPreviewRoute
import id.petalytix.ayailmu.feature.units.UnitsNav
import id.petalytix.ayailmu.feature.units.UnitsRoute
import kotlinx.serialization.Serializable

/**
 * Type-safe routes (CR-ARC-6). First-run onboarding is not a route: the root shows it whenever no profile
 * exists, so "delete all data" (or deleting the last profile) lands there too.
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

    /** P5: learning packs, restore purchases; a child profile meets the adult gate first. */
    @Serializable
    data object Store : AyaRoute

    /** P6: today's puzzle (Home). */
    @Serializable
    data object Puzzle : AyaRoute

    @Serializable
    data object Gems : AyaRoute

    @Serializable
    data object Stickers : AyaRoute

    /** P6: adults only, opt-in from Progress; [track] read back by SpeedRoundViewModel. */
    @Serializable
    data class SpeedRound(
        val track: String,
    ) : AyaRoute

    /**
     * Follow-up 12: one module (MODULES_LEVELS_STORIES.md section 1): language picker, level ladder, the chosen track's
     * session, units and progress. [code] is `Subject.code` ("BHS", "NIL" …); read back by ModuleViewModel.
     */
    @Serializable
    data class Module(
        val code: String,
    ) : AyaRoute

    /** Follow-up 12, Sejarah: «Galeri tokoh», the figures met in the history stories (feature/collection). */
    @Serializable
    data object Figures : AyaRoute

    /** P5/P6: every unit of a track (module screen, Progress); open, locked or done. */
    @Serializable
    data class Units(
        val track: String,
    ) : AyaRoute

    /** «Coba satu soal»: one question from a (usually locked) unit; nothing saved. */
    @Serializable
    data class UnitPreview(
        val track: String,
        val unit: String,
    ) : AyaRoute

    /** P6: the unit challenge; finishing it earns the unit's sticker. */
    @Serializable
    data class UnitChallenge(
        val track: String,
        val unit: String,
    ) : AyaRoute

    /**
     * P7 trial questionnaires: [kind] background (after consent), day7 or end; read back by SurveyViewModel.
     * [thenSession]: straight after consent, the first session follows; opened from a Home or Settings card,
     * the form just goes back.
     */
    @Serializable
    data class Survey(
        val kind: String,
        val track: String,
        val thenSession: Boolean = false,
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
                        startModule = { card -> navController.startTrack(card) },
                        openModule = { subject -> navController.navigate(AyaRoute.Module(subject.code)) { launchSingleTop = true } },
                        openSettings = { navController.navigate(AyaRoute.Settings) { launchSingleTop = true } },
                        addProfile = { navController.navigate(AyaRoute.AddProfile) { launchSingleTop = true } },
                        openStore = { navController.navigate(AyaRoute.Store) { launchSingleTop = true } },
                        openPuzzle = { navController.navigate(AyaRoute.Puzzle) { launchSingleTop = true } },
                        openGems = { navController.navigate(AyaRoute.Gems) { launchSingleTop = true } },
                        openStickers = { navController.navigate(AyaRoute.Stickers) { launchSingleTop = true } },
                        openSurvey = { card -> navController.navigate(AyaRoute.Survey(card.kind.code, card.track)) { launchSingleTop = true } },
                    ),
            )
        }
        composable<AyaRoute.Module> {
            ModuleRoute(
                nav =
                    ModuleNav(
                        back = { navController.popBackStack() },
                        start = { card -> navController.startTrack(card) },
                        units = { track -> navController.navigate(AyaRoute.Units(track)) { launchSingleTop = true } },
                        progress = { track -> navController.navigate(AyaRoute.Progress(track)) { launchSingleTop = true } },
                        store = { navController.navigate(AyaRoute.Store) { launchSingleTop = true } },
                        figures = { navController.navigate(AyaRoute.Figures) { launchSingleTop = true } },
                    ),
            )
        }
        composable<AyaRoute.Figures> {
            FiguresRoute(onBack = { navController.popBackStack() })
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
                // Background questions (E-B1..E-B4) come between consent and the first session; skippable.
                onAccepted = { track ->
                    navController.navigate(AyaRoute.Survey(SurveyKind.BACKGROUND.code, track, thenSession = true)) {
                        popUpTo(AyaRoute.Home) { inclusive = false }
                    }
                },
                onBack = { navController.popBackStack() },
            )
        }
        composable<AyaRoute.Survey> { entry ->
            val route = entry.toRoute<AyaRoute.Survey>()
            SurveyRoute(
                onDone = {
                    if (route.thenSession) {
                        navController.navigate(AyaRoute.Session(route.track)) {
                            popUpTo(AyaRoute.Home) { inclusive = false }
                        }
                    } else {
                        navController.popBackStack()
                    }
                },
            )
        }
        composable<AyaRoute.Units> { entry ->
            val track = entry.toRoute<AyaRoute.Units>().track
            UnitsRoute(
                nav =
                    UnitsNav(
                        back = { navController.popBackStack() },
                        preview = { unit -> navController.navigate(AyaRoute.UnitPreview(track, unit)) { launchSingleTop = true } },
                        challenge = { unit -> navController.navigate(AyaRoute.UnitChallenge(track, unit)) { launchSingleTop = true } },
                        store = { navController.navigate(AyaRoute.Store) { launchSingleTop = true } },
                    ),
            )
        }
        composable<AyaRoute.UnitPreview> {
            UnitPreviewRoute(
                onBack = { navController.popBackStack() },
                onStore = { navController.navigate(AyaRoute.Store) { launchSingleTop = true } },
            )
        }
        composable<AyaRoute.UnitChallenge> {
            UnitChallengeRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.Progress> { entry ->
            val track = entry.toRoute<AyaRoute.Progress>().track
            ProgressRoute(
                nav =
                    ProgressNav(
                        back = { navController.popBackStack() },
                        speedRound = { navController.navigate(AyaRoute.SpeedRound(track)) { launchSingleTop = true } },
                        gems = { navController.navigate(AyaRoute.Gems) { launchSingleTop = true } },
                        stickers = { navController.navigate(AyaRoute.Stickers) { launchSingleTop = true } },
                        units = { navController.navigate(AyaRoute.Units(track)) { launchSingleTop = true } },
                    ),
            )
        }
        composable<AyaRoute.Settings> {
            SettingsRoute(
                onBack = { navController.popBackStack() },
                onOpenStore = { navController.navigate(AyaRoute.Store) { launchSingleTop = true } },
                onOpenSurvey = { card -> navController.navigate(AyaRoute.Survey(card.kind.code, card.track)) { launchSingleTop = true } },
            )
        }
        composable<AyaRoute.Store> {
            StoreRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.Puzzle> {
            DailyPuzzleRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.Gems> {
            GemBoxRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.Stickers> {
            StickerShelfRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.SpeedRound> {
            SpeedRoundRoute(onBack = { navController.popBackStack() })
        }
        composable<AyaRoute.AddProfile> {
            OnboardingRoute(
                onDone = { navController.popBackStack(AyaRoute.Home, inclusive = false) },
                onCancel = { navController.popBackStack() },
            )
        }
    }
}

/**
 * Today's session on a module's chosen track (Home «Mulai», the module screen): the trial consent first on an evidence
 * track the profile has not agreed to yet, otherwise the session itself.
 */
private fun NavHostController.startTrack(card: ModuleCard) {
    val route: AyaRoute = if (card.needsConsent) AyaRoute.Consent(card.track) else AyaRoute.Session(card.track)
    navigate(route) { launchSingleTop = true }
}
