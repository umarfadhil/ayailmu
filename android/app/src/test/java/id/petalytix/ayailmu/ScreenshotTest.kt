package id.petalytix.ayailmu

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.consent.ConsentScreen
import id.petalytix.ayailmu.feature.consent.ConsentUiState
import id.petalytix.ayailmu.feature.home.HomeNav
import id.petalytix.ayailmu.feature.home.HomeScreen
import id.petalytix.ayailmu.feature.home.previewHomeState
import id.petalytix.ayailmu.feature.onboarding.OnboardingScreen
import id.petalytix.ayailmu.feature.onboarding.OnboardingStep
import id.petalytix.ayailmu.feature.onboarding.OnboardingUiState
import id.petalytix.ayailmu.feature.progress.Count
import id.petalytix.ayailmu.feature.progress.ProgressData
import id.petalytix.ayailmu.feature.progress.ProgressScreen
import id.petalytix.ayailmu.feature.progress.ProgressSummary
import id.petalytix.ayailmu.feature.progress.ProgressUiState
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionScreen
import id.petalytix.ayailmu.feature.session.SessionUiState
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.settings.SettingsData
import id.petalytix.ayailmu.feature.settings.SettingsScreen
import id.petalytix.ayailmu.feature.settings.SettingsUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshot tests (CR-I18N-6, CR-REL-3): every P3 screen in Indonesian/light, English/dark and Indonesian at
 * font scale 1.5 — one subclass per variant below, so the language comes from Robolectric's resource
 * qualifiers ("in" falls back to values/, which is Indonesian). Plain `testDemoDebugUnitTest` only renders them
 * (catching crashes); baselines are written with `:app:recordRoborazziDemoDebug` and checked with
 * `:app:verifyRoborazziDemoDebug`. A plain Application is used so Hilt and the real database are not started.
 * Placeholder art (P4) will change these images on purpose. Excluded from release unit-test tasks (the Compose
 * test activity is debug-only).
 */
abstract class ScreenshotTest(
    private val variant: String,
    private val dark: Boolean,
    private val fontScale: Float,
) {
    @get:Rule
    val compose = createComposeRule()

    private fun shot(
        screen: String,
        content: @Composable () -> Unit,
    ) {
        compose.setContent {
            // Font scale through density: Compose turns sp into pixels with LocalDensity.fontScale.
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                AyaTheme(darkTheme = dark) { PaperBackground { content() } }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/${screen}_$variant.png")
    }

    @Test
    fun onboardingLanguage() = shot("onboarding_language") { OnboardingScreen(OnboardingUiState(loading = false, years = YEARS), onEvent = {}, onCancel = null) }

    @Test
    fun onboardingAge() =
        shot("onboarding_age") {
            OnboardingScreen(OnboardingUiState(loading = false, step = OnboardingStep.AGE, years = YEARS), onEvent = {}, onCancel = {})
        }

    @Test
    fun home() = shot("home") { HomeScreen(state = previewHomeState, onEvent = {}, nav = HomeNav()) }

    @Test
    fun sessionChoice() = shot("session_choice") { SessionScreen(state = CHOICE, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionFeedback() = shot("session_feedback") { SessionScreen(state = FEEDBACK, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionSummary() = shot("session_summary") { SessionScreen(state = SUMMARY, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun progress() = shot("progress") { ProgressScreen(state = ProgressUiState.Ready(ProgressData("Bahasa Arab — Unit A", PROGRESS)), onBack = {}) }

    @Test
    fun settings() = shot("settings") { SettingsScreen(state = SettingsUiState(loading = false, data = SETTINGS), onEvent = {}, onBack = {}) }

    @Test
    fun consent() = shot("consent") { ConsentScreen(state = ConsentUiState(track = "arab"), onEvent = {}, onBack = {}) }

    companion object {
        private val YEARS = (2026 downTo 1926).toList()

        private val CHOICE =
            SessionUiState.Running(
                step =
                    StepUi.Question(
                        itemId = "MAT-K-P-01-010",
                        kind = RenderKind.CHOICE,
                        role = Step.Role.PRACTICE,
                        prompt = "Mana yang lebih besar?",
                        target = null,
                        help = emptyList(),
                        options = listOf(OptionUi("a", "17", null, null), OptionUi("b", "71", null, null)),
                    ),
                phase = SessionState.Phase.STEP,
                feedback = null,
                position = 3,
                total = 10,
                draft = true,
            )

        private val FEEDBACK =
            CHOICE.copy(
                step =
                    StepUi.Question(
                        itemId = "DEMO-P01",
                        kind = RenderKind.PARAPHRASE,
                        role = Step.Role.PRACTICE,
                        prompt = "Apa arti kalimat ini?",
                        target = "هِيَ مُؤْمِنَةٌ",
                        help = emptyList(),
                    ),
                phase = SessionState.Phase.FEEDBACK,
                feedback = FeedbackView("DEMO-P01", Outcome.PENDING, listOf("Jawaban Anda kami simpan untuk dicek.")),
            )

        private val SUMMARY = SessionUiState.Done(Session.Summary(9, 6, 2, 0, 1, emptyList(), 1, 0, 1, 8, "2026-10-18", emptyList()))

        private val PROGRESS =
            ProgressSummary(
                mode = TrackMode.EVIDENCE,
                learned = Count(3, 9),
                remembered = Count(2, 3),
                newSentences = Count(0, 0),
                words = Count(4, 12),
                practicing = 5,
                needsFollowUp = 1,
                waitingForCheck = 2,
                gems = 1,
                daysPracticed = 6,
            )

        private val SETTINGS =
            SettingsData(
                profile =
                    Profile(
                        id = "lrn-6f1c2a9e",
                        label = "Umar",
                        kind = ProfileKind.ADULT,
                        createdBy = null,
                        birthYear = 1990,
                        audience = Audience.ADULTS,
                        lang = Lang.ID,
                        createdAtMs = 0L,
                        sessionMinutes = 15,
                        arabicScale = 1.2f,
                        screensSeen = emptyList(),
                        consentVersion = "arab-trial-1",
                    ),
                sessionOptions = listOf(10, 15, 20),
                showArabicSize = true,
                reminder = ReminderSetting(enabled = true, hour = 19, minute = 30),
                appVersion = "0.1.0-demo",
            )
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "in-w360dp-h800dp-xhdpi")
class ScreenshotIdLightTest : ScreenshotTest("id_light", dark = false, fontScale = 1f)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h800dp-night-xhdpi")
class ScreenshotEnDarkTest : ScreenshotTest("en_dark", dark = true, fontScale = 1f)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "in-w360dp-h800dp-xhdpi")
class ScreenshotIdFont150Test : ScreenshotTest("id_font150", dark = false, fontScale = 1.5f)
